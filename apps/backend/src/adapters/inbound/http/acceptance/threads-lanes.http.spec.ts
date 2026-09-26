import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../../app.module";
import {
  createPersistenceClient,
  type SqliteDb,
} from "../../../outbound/persistence/client";

// apps/backend/src/adapters/inbound/http/acceptance -> apps/backend/drizzle/migrations.
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
  "sqlite",
);

const OWNER_EMAIL = "owner@harbourandpine.example";
const OWNER_PASSWORD = "owner-test-secret";
const INGRESS_KEY = "test-ingress-key";

let dbFile: string;
let app: INestApplication;

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "mbx_harbour_pine",
    sourceMessageId: "src-1",
    messageId: "<msg-1@customer.example>",
    inReplyTo: undefined,
    references: undefined,
    from: { address: "sam@example.test", name: "Sam" },
    to: ["mb_main@harbourandpine.example"],
    cc: undefined,
    replyTo: undefined,
    subject: "Oven clean",
    text: "Hi, how much for an oven clean?",
    html: undefined,
    attachments: undefined,
    receivedAt: "2025-06-01T00:00:00.000Z",
    sentAt: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  dbFile = join(
    mkdtempSync(join(tmpdir(), "bos-threads-lanes-http-")),
    "test.db",
  );
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOS_INGRESS_KEY = INGRESS_KEY;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  delete process.env.COOKIE_SECURE;

  const client = createPersistenceClient();
  migrate(client.open() as SqliteDb, { migrationsFolder: MIGRATIONS });

  const { Test } = await import("@nestjs/testing");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  rmSync(dbFile, { force: true });
});

async function loginCookie(): Promise<string> {
  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  return login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

async function ingest(
  sourceMessageId: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app.getHttpServer())
    .post("/inbound/emails")
    .set("Authorization", `Bearer ${INGRESS_KEY}`)
    .send(
      fixture({
        sourceMessageId,
        messageId: `<${sourceMessageId}@customer.example>`,
        ...overrides,
      }),
    );
}

async function threadOf(cookie: string, conversationId: string) {
  const response = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  expect(response.status).toBe(200);
  return response.body;
}

describe("thread lane surfaces over HTTP (slice 7)", () => {
  it("the service lane surfaces the internal serviceNote and no draft", async () => {
    const cookie = await loginCookie();
    const response = await ingest("src-service", {
      subject: "[bos:service] Please book a clean",
      text: "Hi, can we book a clean for next week?",
    });
    expect(response.status).toBe(201);
    expect(response.body.processing).toBe("ready");
    const thread = await threadOf(cookie, response.body.conversationId);
    expect(thread.serviceNote).toEqual({
      request: "[bos:service] Please book a clean",
      supplied: [],
      missing: [],
      nextAction: "Reply to the customer to arrange the service.",
    });
    expect(thread.draft).toBeUndefined();
  });

  it("the complaint lane is urgent, needs_human, and shows the fixed draft", async () => {
    const cookie = await loginCookie();
    const response = await ingest("src-complaint", {
      subject: "Terrible service",
      text: "I am very unhappy, the kitchen was damaged. I want a refund.",
    });
    expect(response.status).toBe(201);
    expect(response.body.processing).toBe("needs_human");
    const thread = await threadOf(cookie, response.body.conversationId);
    expect(thread.processing).toMatchObject({
      lane: "complaint",
      status: "needs_human",
    });
    expect(thread.draft).toMatchObject({
      status: "proposed",
      bodyText: "Thanks — the owner will reply personally.",
    });
    // Urgent in the inbox and present in the complaints filter.
    const inbox = await request(app.getHttpServer())
      .get("/inbox?filter=complaints")
      .set("Cookie", cookie);
    expect(
      inbox.body.items.some(
        (item: { conversationId: string; urgent: boolean }) =>
          item.conversationId === response.body.conversationId && item.urgent,
      ),
    ).toBe(true);
  });

  it("a quote reply threads in, shows intent and candidates, and decides nothing", async () => {
    const cookie = await loginCookie();
    // Quote → approve → send, then a customer reply to the outbound message.
    const quote = await ingest("src-quote-flow", {
      text: "How much for an oven clean?",
    });
    const quoteThread = await threadOf(cookie, quote.body.conversationId);
    const draft = quoteThread.draft as { revisionId: string };
    await request(app.getHttpServer())
      .post(`/threads/${quote.body.conversationId}/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });
    await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId: draft.revisionId });

    const reply = await ingest("src-quote-reply", {
      messageId: "<quote-reply-1@customer.example>",
      // The sent message's RFC Message-ID is <revisionId@host>.
      inReplyTo: `<${draft.revisionId}@harbourandpine.example>`,
      subject: "Re: Oven clean",
      text: "Thanks — I accept the quote.",
      // Far-future receipt so the reply is the conversation's latest
      // message (the sent outbound row carries the real wall clock).
      receivedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(reply.status).toBe(201);
    expect(reply.body.conversationId).toBe(quote.body.conversationId);
    // A clear accept with one candidate is the ready owner action item.
    expect(reply.body.processing).toBe("ready");

    const thread = await threadOf(cookie, quote.body.conversationId);
    expect(thread.processing).toMatchObject({ lane: "quote_reply" });
    expect(thread.quoteReply.intent).toBe("accept");
    expect(thread.quoteReply.candidateQuoteVersionIds).toHaveLength(1);
    const candidate = thread.quoteReply.candidateQuoteVersionIds[0] as string;
    expect(thread.openQuote).toMatchObject({
      quoteVersionId: candidate,
      status: "sent",
    });
  });
});

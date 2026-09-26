import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../../../app.module";
import {
  createPersistenceClient,
  type PersistenceClient,
  type SqliteDb,
} from "../../../outbound/persistence/client";
import {
  sqliteAuditEvents,
  sqliteQuoteVersions,
} from "../../../outbound/persistence/schema";

// apps/backend/src/adapters/inbound/http/public-quotes -> apps/backend/drizzle/migrations.
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
let client: PersistenceClient;

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "mbx_harbour_pine",
    sourceMessageId: "src-quote-1",
    messageId: "<quote-1@customer.example>",
    inReplyTo: undefined,
    references: undefined,
    from: { address: "sam@example.test", name: "Sam" },
    to: ["mbx_harbour_pine@harbourandpine.example"],
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

/** One fully sent quote: ingress → approve → send; returns thread + token. */
async function sentQuote(
  sourceMessageId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ conversationId: string; revisionId: string; token: string }> {
  const ingress = await request(app.getHttpServer())
    .post("/inbound/emails")
    .set("Authorization", `Bearer ${INGRESS_KEY}`)
    .send(fixture({ sourceMessageId, ...overrides }));
  expect(ingress.status).toBe(201);
  const { conversationId } = ingress.body as {
    conversationId: string;
  };

  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";

  const threadBefore = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  const revisionId = threadBefore.body.draft?.revisionId as string;

  const approve = await request(app.getHttpServer())
    .post(`/threads/${conversationId}/drafts/${revisionId}`)
    .set("Cookie", cookie)
    .send({ action: "approve" });
  expect(approve.status).toBe(201);

  const send = await request(app.getHttpServer())
    .post(`/drafts/${revisionId}/send`)
    .set("Cookie", cookie)
    .send({ revisionId });
  expect(send.status).toBe(200);

  // The real link lives in the outbound message body: read it back from
  // the thread (the only place the raw token ever appears in a response).
  const thread = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  const outbound = (
    thread.body.messages as Array<{ direction: string; text?: string }>
  ).find((message) => message.direction === "outbound");
  const token = outbound?.text?.match(/\/quote\/(\S+)/)?.[1] as string;
  expect(token).toBeDefined();
  return { conversationId, revisionId, token };
}

beforeAll(async () => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-public-quotes-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOS_INGRESS_KEY = INGRESS_KEY;
  process.env.PUBLIC_APP_URL = "http://127.0.0.1:3000";
  delete process.env.COOKIE_SECURE;

  client = createPersistenceClient();
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

describe("public quote routes over HTTP (task 6.5)", () => {
  it("serves the quote display without any session, never decides on GET, and never logs the raw token", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    let token = "";
    try {
      const { token: sent } = await sentQuote("src-pq-1");
      token = sent;

      // No session, no cookie: the unguessable token is the credential.
      const shown = await request(app.getHttpServer()).get(
        `/public/quotes/${token}`,
      );
      expect(shown.status).toBe(200);
      expect(shown.body).toEqual({
        businessName: "Harbour & Pine Cleaning",
        status: "sent",
        currency: "AUD",
        lines: [{ name: "Oven clean", amountMinor: 6500 }],
        assumptions: [],
        subtotalMinor: 6500,
        taxMinor: 650,
        totalMinor: 7150,
        validUntil: expect.any(String),
        canDecide: true,
      });
      // A link scanner that only GETs cannot decide.
      const db = client.open() as SqliteDb;
      const rows = await db
        .select()
        .from(sqliteQuoteVersions)
        .where(eq(sqliteQuoteVersions.tokenHash, tokenHashOf(token)));
      expect(rows[0]).toMatchObject({ status: "sent", decidedAt: null });
    } finally {
      const logged = stdout.mock.calls.map((call) => String(call[0])).join("");
      stdout.mockRestore();
      expect(logged).not.toContain(token);
    }
  });

  it("records an explicit accept and its customer audit, then replays idempotently", async () => {
    const { token, conversationId } = await sentQuote("src-pq-2");
    const accept = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "accept" });
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ status: "accepted", canDecide: false });

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const ownerThread = await request(app.getHttpServer())
      .get(`/threads/${conversationId}`)
      .set("Cookie", cookie);
    expect(ownerThread.status).toBe(200);
    expect(ownerThread.body.openQuote).toBeUndefined();
    expect(ownerThread.body.quote).toMatchObject({
      status: "accepted",
      decision: "accept",
      currency: "AUD",
    });

    const db = client.open() as SqliteDb;
    const audits = await db
      .select()
      .from(sqliteAuditEvents)
      .where(eq(sqliteAuditEvents.action, "quote.accepted"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: "customer" });

    // Same decision again: 200 idempotent, no duplicate audit row.
    const replay = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "accept" });
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("accepted");
    expect(
      await db
        .select()
        .from(sqliteAuditEvents)
        .where(eq(sqliteAuditEvents.action, "quote.accepted")),
    ).toHaveLength(1);

    // Conflicting decision: 409 conflict.
    const conflict = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "decline" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("conflict");
  });

  it("records an explicit decline", async () => {
    const { token } = await sentQuote("src-pq-3");
    const decline = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "decline" });
    expect(decline.status).toBe(200);
    expect(decline.body).toMatchObject({ status: "declined" });
    const db = client.open() as SqliteDb;
    expect(
      await db
        .select()
        .from(sqliteAuditEvents)
        .where(eq(sqliteAuditEvents.action, "quote.declined")),
    ).toHaveLength(1);
  });

  it("answers 404 not_found for unknown tokens on both routes", async () => {
    const get = await request(app.getHttpServer()).get(
      "/public/quotes/definitely-not-a-token",
    );
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe("not_found");

    const post = await request(app.getHttpServer())
      .post("/public/quotes/definitely-not-a-token/decision")
      .send({ decision: "accept" });
    expect(post.status).toBe(404);
    expect(post.body.error.code).toBe("not_found");
  });

  it("answers 422 validation for an invalid decision value", async () => {
    const { token } = await sentQuote("src-pq-4");
    const bad = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "maybe" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("validation");
    // Nothing was decided.
    const shown = await request(app.getHttpServer()).get(
      `/public/quotes/${token}`,
    );
    expect(shown.body.status).toBe("sent");
  });

  it("answers 404 on both routes for an expired token", async () => {
    const { token } = await sentQuote("src-pq-5");
    const db = client.open() as SqliteDb;
    await db
      .update(sqliteQuoteVersions)
      .set({ validUntil: "2020-01-01T00:00:00.000Z" })
      .where(eq(sqliteQuoteVersions.tokenHash, tokenHashOf(token)));

    const get = await request(app.getHttpServer()).get(
      `/public/quotes/${token}`,
    );
    expect(get.status).toBe(404);
    const post = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "accept" });
    expect(post.status).toBe(404);
  });

  it("answers 404 on both routes for a superseded token", async () => {
    const { token } = await sentQuote("src-pq-6");
    const db = client.open() as SqliteDb;
    await db
      .update(sqliteQuoteVersions)
      .set({ status: "superseded" })
      .where(eq(sqliteQuoteVersions.tokenHash, tokenHashOf(token)));

    const get = await request(app.getHttpServer()).get(
      `/public/quotes/${token}`,
    );
    expect(get.status).toBe(404);
    const post = await request(app.getHttpServer())
      .post(`/public/quotes/${token}/decision`)
      .send({ decision: "accept" });
    expect(post.status).toBe(404);
  });

  it("a second sent quote in one conversation supersedes the first and revokes its token", async () => {
    const { token: first } = await sentQuote("src-pq-7a", {
      messageId: "<quote-7a@customer.example>",
    });
    // A reply on the same thread gets a new quote draft and version.
    const second = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-pq-7b",
          messageId: "<quote-7b@customer.example>",
          inReplyTo: "<quote-7a@customer.example>",
          text: "Hi again, how much for an oven clean and a regular clean for 3 bedrooms?",
        }),
      );
    expect(second.status).toBe(201);
    expect(second.body.conversationId).toBeDefined();

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const thread = await request(app.getHttpServer())
      .get(`/threads/${second.body.conversationId}`)
      .set("Cookie", cookie);
    expect(thread.body.openQuote).toMatchObject({
      status: "prepared",
      totalMinor: expect.any(Number),
      currency: "AUD",
    });
    const revisionId = thread.body.draft?.revisionId as string;
    await request(app.getHttpServer())
      .post(`/threads/${second.body.conversationId}/drafts/${revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });
    const send = await request(app.getHttpServer())
      .post(`/drafts/${revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId });
    expect(send.status).toBe(200);

    // The first token is revoked by the supersede: 404 on both routes.
    const get = await request(app.getHttpServer()).get(
      `/public/quotes/${first}`,
    );
    expect(get.status).toBe(404);
    const post = await request(app.getHttpServer())
      .post(`/public/quotes/${first}/decision`)
      .send({ decision: "accept" });
    expect(post.status).toBe(404);
  });
});

/** The stored form of a raw token: SHA-256 hex, never the token itself. */
function tokenHashOf(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

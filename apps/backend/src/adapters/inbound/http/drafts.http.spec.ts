import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { EMAIL_SENDER_PORT } from "../../../core/ports/email-sender";
import {
  createPersistenceClient,
  type SqliteDb,
} from "../../outbound/persistence/client";

// apps/backend/src/adapters/inbound/http -> apps/backend/drizzle/migrations.
const MIGRATIONS = join(
  __dirname,
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
    subject: "What are your hours and areas?",
    text: "What are your opening hours and areas?",
    html: undefined,
    attachments: undefined,
    receivedAt: "2025-06-01T00:00:00.000Z",
    sentAt: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-drafts-http-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOS_INGRESS_KEY = INGRESS_KEY;
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

/** Ingests a fresh FAQ fixture and returns its ids. */
async function ingest(
  sourceMessageId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request(app.getHttpServer())
    .post("/inbound/emails")
    .set("Authorization", `Bearer ${INGRESS_KEY}`)
    .send(
      fixture({
        sourceMessageId,
        messageId: `<${sourceMessageId}@customer.example>`,
        ...overrides,
      }),
    );
  expect(response.status).toBe(201);
  expect(response.body.processing).toBe("ready");
  return response.body as {
    messageId: string;
    conversationId: string;
  };
}

async function threadDraft(
  cookie: string,
  conversationId: string,
): Promise<{ revisionId: string; status: string; bodyText: string }> {
  const thread = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  expect(thread.status).toBe(200);
  const draft = thread.body.draft as {
    revisionId: string;
    status: string;
    bodyText: string;
  };
  expect(draft).toBeDefined();
  return draft;
}

describe("POST /threads/:conversationId/drafts/:revisionId over HTTP", () => {
  it("requires the session", async () => {
    const { conversationId } = await ingest("src-anon");
    const draft = await threadDraft("", conversationId).catch(() => undefined);
    const response = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/whatever`)
      .send({ action: "approve" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(draft).toBeUndefined();
  });

  it("approves the exact revision and returns it", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingest("src-approve");
    const draft = await threadDraft(cookie, conversationId);

    const response = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      revisionId: draft.revisionId,
      status: "approved",
      bodyText: draft.bodyText,
    });
    expect(await threadDraft(cookie, conversationId)).toMatchObject({
      revisionId: draft.revisionId,
      status: "approved",
    });
  });

  it("edit creates a new proposed revision and supersedes the approved one", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingest("src-edit");
    const original = await threadDraft(cookie, conversationId);
    await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${original.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });

    const edited = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${original.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "edit", bodyText: "Manually worded reply." });
    expect(edited.status).toBe(201);
    expect(edited.body).toMatchObject({
      status: "proposed",
      bodyText: "Manually worded reply.",
    });
    const next = await threadDraft(cookie, conversationId);
    expect(next.revisionId).not.toBe(original.revisionId);
    expect(next.status).toBe("proposed");

    // The superseded revision is stale: approving it is 409.
    const stale = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${original.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_revision");
  });

  it("discard is terminal and a second discard is 409 stale_revision", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingest("src-discard");
    const draft = await threadDraft(cookie, conversationId);

    const discarded = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "discard" });
    expect(discarded.status).toBe(201);
    expect(discarded.body).toMatchObject({
      revisionId: draft.revisionId,
      status: "discarded",
    });

    const again = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "discard" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("stale_revision");

    // The discarded draft no longer shows on the thread.
    const thread = await request(app.getHttpServer())
      .get(`/threads/${conversationId}`)
      .set("Cookie", cookie);
    expect(thread.body.draft).toBeUndefined();
  });

  it("a malformed action, an empty edit body, and a revision of another conversation are rejected", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingest("src-malformed");
    const draft = await threadDraft(cookie, conversationId);
    const path = `/threads/${conversationId}/drafts/${draft.revisionId}`;

    const unknownAction = await request(app.getHttpServer())
      .post(path)
      .set("Cookie", cookie)
      .send({ action: "explode" });
    expect(unknownAction.status).toBe(422);
    expect(unknownAction.body.error.code).toBe("validation");

    const emptyEdit = await request(app.getHttpServer())
      .post(path)
      .set("Cookie", cookie)
      .send({ action: "edit", bodyText: "   " });
    expect(emptyEdit.status).toBe(422);

    const foreign = await request(app.getHttpServer())
      .post(`/threads/ulid-other/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("not_found");
  });
});

describe("POST /threads/:conversationId/take-over over HTTP", () => {
  it("requires the session and pauses the conversation", async () => {
    const { conversationId } = await ingest("src-takeover");

    const anonymous = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/take-over`)
      .send({});
    expect(anonymous.status).toBe(401);

    const cookie = await loginCookie();
    const before = await threadDraft(cookie, conversationId);
    const response = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/take-over`)
      .set("Cookie", cookie)
      .send({});
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ automationPaused: true });

    const thread = await request(app.getHttpServer())
      .get(`/threads/${conversationId}`)
      .set("Cookie", cookie);
    expect(thread.body.conversation.automationPaused).toBe(true);

    // While paused, a new FAQ email is still classified (a processing
    // revision appears) but the draft is untouched: same revision, same
    // status, no new draft.
    const reply = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-takeover-2",
          inReplyTo: "<src-takeover@customer.example>",
          subject: "Re: What are your hours and areas?",
          receivedAt: "2025-06-02T00:00:00.000Z",
        }),
      );
    expect(reply.status).toBe(201);
    expect(reply.body.conversationId).toBe(conversationId);
    expect(reply.body.processing).toBe("needs_human");
    const after = await threadDraft(cookie, conversationId);
    expect(after).toEqual(before);

    const unknown = await request(app.getHttpServer())
      .post("/threads/ulid-nope/take-over")
      .set("Cookie", cookie)
      .send({});
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
  });
});

describe("POST /drafts/:revisionId/send and GET /outbox over HTTP", () => {
  it("sends an approved draft, replays idempotently, and lists the outbox row", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingest("src-send");
    const draft = await threadDraft(cookie, conversationId);

    // Sending a proposed draft is 409 conflict.
    const unapproved = await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId: draft.revisionId });
    expect(unapproved.status).toBe(409);
    expect(unapproved.body.error.code).toBe("conflict");

    await request(app.getHttpServer())
      .post(`/threads/${conversationId}/drafts/${draft.revisionId}`)
      .set("Cookie", cookie)
      .send({ action: "approve" });

    // The redundant path id must match the body (else 422).
    const mismatch = await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId: "ulid-something-else" });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("validation");

    const missing = await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({});
    expect(missing.status).toBe(422);

    const send = await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId: draft.revisionId });
    expect(send.status).toBe(200);
    expect(send.body).toMatchObject({
      conversationId,
      revisionId: draft.revisionId,
    });
    const messageId = send.body.messageId as string;
    expect(messageId).toEqual(expect.any(String));

    // Replay: the same revision sent again returns the same message.
    const replay = await request(app.getHttpServer())
      .post(`/drafts/${draft.revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId: draft.revisionId });
    expect(replay.status).toBe(200);
    expect(replay.body.messageId).toBe(messageId);

    // The thread now shows the outbound message; the draft is consumed.
    const thread = await request(app.getHttpServer())
      .get(`/threads/${conversationId}`)
      .set("Cookie", cookie);
    expect(thread.body.messages).toHaveLength(2);
    expect(thread.body.draft).toBeUndefined();
    const outbound = thread.body.messages.find(
      (message: { direction: string }) => message.direction === "outbound",
    );
    expect(outbound).toMatchObject({
      from: "hello@harbourandpine.example",
      subject: "Re: What are your hours and areas?",
      text: draft.bodyText,
    });

    // Sending an unknown revision is 404.
    const unknown = await request(app.getHttpServer())
      .post("/drafts/ulid-nope/send")
      .set("Cookie", cookie)
      .send({ revisionId: "ulid-nope" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");

    // GET /outbox requires the session.
    const anonymous = await request(app.getHttpServer()).get("/outbox");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("unauthorized");

    // The outbox row is visible after the send, newest first, queued,
    // with an empty last-error column in the happy path.
    const outbox = await request(app.getHttpServer())
      .get("/outbox")
      .set("Cookie", cookie);
    expect(outbox.status).toBe(200);
    const items = outbox.body.items as Array<{
      messageId: string;
      conversationId: string;
      recipient: string;
      status: string;
      attempts: number;
      lastError: string | null;
      createdAt: string;
    }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    const row = items.find((item) => item.messageId === messageId);
    expect(row).toEqual({
      messageId,
      conversationId,
      recipient: "sam@example.test",
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: expect.any(String),
    });

    // No route marked the row beyond `queued`, and no route invoked the
    // email sender (PLAN.md task 5.5: recording fake, unused by HTTP).
    expect(
      items.every(
        (item) =>
          item.status === "queued" ||
          item.status === "failed" ||
          item.status === "uncertain",
      ),
    ).toBe(true);
    const sender = app.get(EMAIL_SENDER_PORT) as { recorded: unknown[] };
    expect(sender.recorded).toHaveLength(0);
  });
});

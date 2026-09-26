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
  type PersistenceClient,
  type SqliteDb,
} from "../../../outbound/persistence/client";
import { sqliteAuditEvents } from "../../../outbound/persistence/schema";

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
let client: PersistenceClient;
let db: SqliteDb;

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
    mkdtempSync(join(tmpdir(), "bos-quote-decision-http-")),
    "test.db",
  );
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOS_INGRESS_KEY = INGRESS_KEY;
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  delete process.env.COOKIE_SECURE;

  client = createPersistenceClient();
  db = client.open() as SqliteDb;
  migrate(db, { migrationsFolder: MIGRATIONS });

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

async function post(
  cookie: string,
  path: string,
  body: Record<string, unknown>,
) {
  return request(app.getHttpServer())
    .post(path)
    .set("Cookie", cookie)
    .send(body);
}

/** Ingests a quote request and returns the thread ids the flow needs. */
async function ingestQuote(sourceMessageId: string) {
  const response = await request(app.getHttpServer())
    .post("/inbound/emails")
    .set("Authorization", `Bearer ${INGRESS_KEY}`)
    .send(
      fixture({
        sourceMessageId,
        messageId: `<${sourceMessageId}@customer.example>`,
      }),
    );
  expect(response.status).toBe(201);
  return response.body as { conversationId: string };
}

/** Full quote flow: ingest → approve → send; returns the live ids. */
async function sentQuote(cookie: string, sourceMessageId: string) {
  const { conversationId } = await ingestQuote(sourceMessageId);
  const thread = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  const draft = thread.body.draft as {
    revisionId: string;
    status: string;
  };
  expect(draft.status).toBe("proposed");
  const approved = await post(
    cookie,
    `/threads/${conversationId}/drafts/${draft.revisionId}`,
    { action: "approve" },
  );
  expect(approved.status).toBe(201);
  const sent = await request(app.getHttpServer())
    .post(`/drafts/${draft.revisionId}/send`)
    .set("Cookie", cookie)
    .send({ revisionId: draft.revisionId });
  expect(sent.status).toBe(200);
  const openQuote = thread.body.openQuote as { quoteVersionId: string };
  return { conversationId, revisionId: draft.revisionId, openQuote };
}

/** Every audit row of this organization, straight from the database. */
async function auditRows() {
  return db.select().from(sqliteAuditEvents);
}

describe("POST /threads/:conversationId/quote-decision over HTTP", () => {
  it("requires the session", async () => {
    const { conversationId } = await ingestQuote("src-anon");
    const response = await request(app.getHttpServer())
      .post(`/threads/${conversationId}/quote-decision`)
      .send({ quoteVersionId: "ulid-x", decision: "accept" });
    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({ code: "unauthorized" });
  });

  it("rejects a malformed body with 422", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingestQuote("src-malformed");
    const missing = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      {
        decision: "accept",
      },
    );
    expect(missing.status).toBe(422);
    const badDecision = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: "ulid-x", decision: "maybe" },
    );
    expect(badDecision.status).toBe(422);
  });

  it("confirms an accept: 200, accepted status, operator-email audit", async () => {
    const cookie = await loginCookie();
    const { conversationId, openQuote } = await sentQuote(
      cookie,
      "src-confirm-accept",
    );
    const response = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "accept" },
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      kind: "confirmed",
      status: "accepted",
      decision: "accept",
    });
    const events = await auditRows();
    const confirmEvent = events.find(
      (row) =>
        row.entityId === openQuote.quoteVersionId &&
        row.action === "quote.accepted",
    );
    // Carried note 14: the audit event names the operator email.
    expect(confirmEvent).toMatchObject({
      actor: OWNER_EMAIL,
      action: "quote.accepted",
    });
  });

  it("confirms a decline the same way", async () => {
    const cookie = await loginCookie();
    const { conversationId, openQuote } = await sentQuote(
      cookie,
      "src-confirm-decline",
    );
    const response = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "decline" },
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "declined" });
  });

  it("replaying the same decision is idempotent", async () => {
    const cookie = await loginCookie();
    const { conversationId, openQuote } = await sentQuote(cookie, "src-replay");
    const first = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "accept" },
    );
    expect(first.status).toBe(201);
    const eventsAfterFirst = (await auditRows()).length;
    const second = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "accept" },
    );
    expect(second.status).toBe(201);
    expect((await auditRows()).length).toBe(eventsAfterFirst);
  });

  it("a conflicting decision is 409", async () => {
    const cookie = await loginCookie();
    const { conversationId, openQuote } = await sentQuote(
      cookie,
      "src-conflict",
    );
    await post(cookie, `/threads/${conversationId}/quote-decision`, {
      quoteVersionId: openQuote.quoteVersionId,
      decision: "accept",
    });
    const conflicting = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "decline" },
    );
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error).toMatchObject({ code: "conflict" });
  });

  it("an unknown quote version is 404", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingestQuote("src-unknown-quote");
    const response = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: "ulid-no-such-quote", decision: "accept" },
    );
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "not_found" });
  });

  it("a prepared (not sent) quote version is 409", async () => {
    const cookie = await loginCookie();
    const { conversationId } = await ingestQuote("src-prepared");
    const thread = await request(app.getHttpServer())
      .get(`/threads/${conversationId}`)
      .set("Cookie", cookie);
    const openQuote = thread.body.openQuote as { quoteVersionId: string };
    const response = await post(
      cookie,
      `/threads/${conversationId}/quote-decision`,
      { quoteVersionId: openQuote.quoteVersionId, decision: "accept" },
    );
    expect(response.status).toBe(409);
  });

  it("audit events across owner actions carry the operator email (note 14)", async () => {
    const cookie = await loginCookie();
    const { conversationId, revisionId } = await sentQuote(
      cookie,
      "src-audit-email",
    );
    const events = await auditRows();
    const draftActions = events
      .filter(
        (row) => row.entityId === revisionId || row.revisionId === revisionId,
      )
      .map((row) => `${row.action}:${row.actor}`);
    expect(draftActions).toContain(`draft.approved:${OWNER_EMAIL}`);
    expect(draftActions).toContain(`draft.sent:${OWNER_EMAIL}`);

    // The remaining audit-writing owner actions — draft.edited,
    // draft.discarded, conversation.takeover — also name the operator
    // email the session guard resolved.
    const { conversationId: editConversationId } =
      await ingestQuote("src-audit-edit");
    const editThread = await request(app.getHttpServer())
      .get(`/threads/${editConversationId}`)
      .set("Cookie", cookie);
    const editedFromRevisionId = (
      editThread.body.draft as { revisionId: string }
    ).revisionId;
    const edited = await post(
      cookie,
      `/threads/${editConversationId}/drafts/${editedFromRevisionId}`,
      { action: "edit", bodyText: "Owner wording." },
    );
    expect(edited.status).toBe(201);

    const { conversationId: discardConversationId } =
      await ingestQuote("src-audit-discard");
    const discardThread = await request(app.getHttpServer())
      .get(`/threads/${discardConversationId}`)
      .set("Cookie", cookie);
    const discardedRevisionId = (
      discardThread.body.draft as { revisionId: string }
    ).revisionId;
    const discarded = await post(
      cookie,
      `/threads/${discardConversationId}/drafts/${discardedRevisionId}`,
      { action: "discard" },
    );
    expect(discarded.status).toBe(201);

    const { conversationId: takeoverConversationId } =
      await ingestQuote("src-audit-takeover");
    const takeover = await post(
      cookie,
      `/threads/${takeoverConversationId}/take-over`,
      {},
    );
    expect(takeover.status).toBe(201);

    const after = await auditRows();
    expect(
      after.find(
        (row) =>
          row.action === "draft.edited" &&
          row.entityId === editedFromRevisionId,
      ),
    ).toMatchObject({ actor: OWNER_EMAIL });
    expect(
      after.find(
        (row) =>
          row.action === "draft.discarded" &&
          row.entityId === discardedRevisionId,
      ),
    ).toMatchObject({ actor: OWNER_EMAIL });
    expect(
      after.find(
        (row) =>
          row.action === "conversation.takeover" &&
          row.entityId === takeoverConversationId,
      ),
    ).toMatchObject({ actor: OWNER_EMAIL });
    // No generic "operator" actor remains anywhere.
    expect(after.every((row) => row.actor !== "operator")).toBe(true);
    expect(conversationId).toBeDefined();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../../../app.module";
import {
  createPersistenceClient,
  type SqliteDb,
} from "../../../outbound/persistence/client";
import { IngressGuard } from "./ingress.guard";
import { TimingSafeIngressKeyComparer } from "./ingress-key-comparer";

// apps/backend/src/adapters/inbound/http/ingress -> apps/backend/drizzle/migrations.
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
    html: "<p>Hi, how much for an oven clean?</p>",
    attachments: undefined,
    receivedAt: "2025-06-01T00:00:00.000Z",
    sentAt: undefined,
    ...overrides,
  };
}

beforeAll(async () => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-ingress-http-")), "test.db");
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.BOS_OWNER_EMAIL = OWNER_EMAIL;
  process.env.BOS_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOS_INGRESS_KEY = INGRESS_KEY;
  delete process.env.COOKIE_SECURE;

  // Tables must exist before the boot-time owner seeder runs on app.init().
  const client = createPersistenceClient();
  migrate(client.open() as SqliteDb, { migrationsFolder: MIGRATIONS });

  const { Test } = await import("@nestjs/testing");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  // Own the fixture server lifetime; do not auto-open/close it per request.
  await app.listen(0, "127.0.0.1");
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

describe("POST /inbound/emails over HTTP", () => {
  it("rejects a missing or wrong bearer key with 401", async () => {
    const noHeader = await request(app.getHttpServer())
      .post("/inbound/emails")
      .send(fixture());
    expect(noHeader.status).toBe(401);
    expect(noHeader.body.error.code).toBe("unauthorized");

    const wrongKey = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", "Bearer definitely-not-the-key")
      .send(fixture());
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body.error.code).toBe("unauthorized");

    const nonBearer = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", INGRESS_KEY)
      .send(fixture());
    expect(nonBearer.status).toBe(401);
  });

  it("stores a new email: 201 with ids and the post-commit processing status", async () => {
    const response = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture());
    expect(response.status).toBe(201);
    expect(response.body.messageId).toEqual(expect.any(String));
    expect(response.body.conversationId).toEqual(expect.any(String));
    expect(response.body.duplicate).toBe(false);
    // "how much" is a quote fixture: high-confidence quote is ready.
    expect(response.body.processing).toBe("ready");
  });

  it("still returns 201 with processing failed for a thrown classifier", async () => {
    const response = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({ sourceMessageId: "src-fail", subject: "[bos:fail] help" }),
      );
    expect(response.status).toBe(201);
    expect(response.body.processing).toBe("failed");
  });

  it("returns 201 with needs_human for a low-confidence message", async () => {
    const response = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-low",
          subject: "[bos:low] how much",
          text: "[bos:low] how much",
        }),
      );
    expect(response.status).toBe(201);
    expect(response.body.processing).toBe("needs_human");
  });

  it("HTML-only mail (no usable text) is needs_human and the message is retained", async () => {
    const response = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-html-only",
          subject: "What are your hours?",
          text: undefined,
          html: "<p>What are your hours?</p>",
        }),
      );
    expect(response.status).toBe(201);
    expect(response.body.processing).toBe("needs_human");

    // The message stays stored and no draft was grounded on it.
    const cookie = await loginCookie();
    const thread = await request(app.getHttpServer())
      .get(`/threads/${response.body.conversationId}`)
      .set("Cookie", cookie);
    expect(thread.status).toBe(200);
    expect(thread.body.messages).toHaveLength(1);
    expect(thread.body.draft).toBeUndefined();
    expect(thread.body.processing.status).toBe("needs_human");
    expect(thread.body.processing.summary).toMatch(/No usable text/);
  });

  it("replays the same source key: 200, original ids, duplicate true", async () => {
    const first = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture({ sourceMessageId: "src-replay" }));
    expect(first.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture({ sourceMessageId: "src-replay" }));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      messageId: first.body.messageId,
      conversationId: first.body.conversationId,
      duplicate: true,
      // The replay reports the stored status; it does not restart processing.
      processing: first.body.processing,
    });
  });

  it("threads a reply fixture into the existing conversation", async () => {
    const first = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-thread-1",
          messageId: "<thread-1@customer.example>",
        }),
      );
    const reply = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-thread-2",
          messageId: "<thread-2@customer.example>",
          inReplyTo: "<thread-1@customer.example>",
          subject: "Re: Oven clean",
        }),
      );
    expect(reply.body.conversationId).toBe(first.body.conversationId);
    expect(reply.body.duplicate).toBe(false);
  });

  it("rejects a mailbox mismatch and a malformed body with 422", async () => {
    const wrongMailbox = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture({ mailboxId: "mb_someone_elses" }));
    expect(wrongMailbox.status).toBe(422);
    expect(wrongMailbox.body.error.code).toBe("validation");

    const malformed = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send({ sourceMessageId: "no-mailbox" });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error.code).toBe("validation");
  });
});

describe("owner reads over HTTP", () => {
  it("requires the session for /inbox and /threads/:id", async () => {
    const inbox = await request(app.getHttpServer()).get("/inbox");
    expect(inbox.status).toBe(401);
    const thread = await request(app.getHttpServer()).get("/threads/ulid-any");
    expect(thread.status).toBe(401);
  });

  it("lists the fixtures newest first and serves the thread with processing", async () => {
    await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-owner-1",
          receivedAt: "2025-06-01T00:00:00.000Z",
        }),
      );
    await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-owner-2",
          from: { address: "jo@example.test", name: "Jo" },
          receivedAt: "2025-06-02T00:00:00.000Z",
        }),
      );

    const cookie = await loginCookie();
    const inbox = await request(app.getHttpServer())
      .get("/inbox")
      .set("Cookie", cookie);
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.length).toBeGreaterThanOrEqual(2);
    const [newest, older] = inbox.body.items;
    expect(newest.from).toEqual({ address: "jo@example.test", name: "Jo" });
    expect(newest.processing).toBe("ready");
    expect(newest.lane).toBe("quote");
    expect(newest.urgent).toBe(false);
    expect(newest.automationPaused).toBe(false);
    expect(newest.preview).toBe("Hi, how much for an oven clean?");
    expect(newest.subject).toBe("Oven clean");
    expect(older.from.address).toBe("sam@example.test");
    expect(newest.latestAt > older.latestAt).toBe(true);

    const thread = await request(app.getHttpServer())
      .get(`/threads/${newest.conversationId}`)
      .set("Cookie", cookie);
    expect(thread.status).toBe(200);
    expect(thread.body.conversation).toEqual({
      id: newest.conversationId,
      customer: { address: "jo@example.test", name: "Jo" },
      subject: "Oven clean",
      automationPaused: false,
    });
    expect(thread.body.messages).toHaveLength(1);
    const message = thread.body.messages[0];
    expect(message.direction).toBe("inbound");
    expect(message.from).toBe("jo@example.test");
    expect(message.text).toBe("Hi, how much for an oven clean?");
    expect(message.at).toBe("2025-06-02T00:00:00.000Z");
    // HTML is stored but never returned to the UI.
    expect(message.html).toBeUndefined();
    // Processing comes from the latest revision (lane, status, summary).
    expect(thread.body.processing).toEqual({
      status: "ready",
      lane: "quote",
      summary: "Quote request",
    });
    // Slice 6: the priceable quote fixture carries a proposed draft whose
    // body holds the link placeholder, plus the open quote version on the
    // thread (amounts from the immutable snapshot).
    expect(thread.body.draft).toMatchObject({
      status: "proposed",
      bodyText: expect.stringContaining("{{quoteLink}}"),
      totalMinor: 7150,
      currency: "AUD",
    });
    expect(thread.body.draft.bodyText).toContain("Oven clean: AUD 65.00");
    expect(thread.body.openQuote).toMatchObject({
      status: "prepared",
      totalMinor: 7150,
      currency: "AUD",
      quoteVersionId: expect.any(String),
    });
  });

  it("filters the inbox: needs_human, complaints, and 422 on an unknown filter", async () => {
    // A complaint fixture ("refund") is urgent; a plain quote is not.
    await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-complaint",
          subject: "Terrible clean",
          text: "I want a refund, the oven was damaged",
        }),
      );
    const cookie = await loginCookie();

    const all = await request(app.getHttpServer())
      .get("/inbox?filter=all")
      .set("Cookie", cookie);
    expect(all.status).toBe(200);
    const complaintItem = all.body.items.find(
      (item: { lane?: string }) => item.lane === "complaint",
    );
    expect(complaintItem).toMatchObject({
      processing: "needs_human",
      urgent: true,
    });

    const needsHuman = await request(app.getHttpServer())
      .get("/inbox?filter=needs_human")
      .set("Cookie", cookie);
    expect(needsHuman.status).toBe(200);
    expect(
      needsHuman.body.items.every(
        (item: { processing: string }) => item.processing === "needs_human",
      ),
    ).toBe(true);
    expect(
      needsHuman.body.items.some(
        (item: { lane?: string }) => item.lane === "complaint",
      ),
    ).toBe(true);

    const complaints = await request(app.getHttpServer())
      .get("/inbox?filter=complaints")
      .set("Cookie", cookie);
    expect(complaints.status).toBe(200);
    expect(complaints.body.items).toHaveLength(1);
    expect(complaints.body.items[0]).toMatchObject({
      lane: "complaint",
      urgent: true,
      processing: "needs_human",
    });

    const invalid = await request(app.getHttpServer())
      .get("/inbox?filter=archived")
      .set("Cookie", cookie);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("validation");
  });

  it("retries processing with a session and rejects anonymous calls", async () => {
    const created = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({ sourceMessageId: "src-retry", subject: "[bos:fail] no" }),
      );
    expect(created.body.processing).toBe("failed");

    const anonymous = await request(app.getHttpServer()).post(
      `/messages/${created.body.messageId}/retry-processing`,
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("unauthorized");

    const cookie = await loginCookie();
    const retry = await request(app.getHttpServer())
      .post(`/messages/${created.body.messageId}/retry-processing`)
      .set("Cookie", cookie);
    // The same subject throws again in the fake, so the retry stays failed.
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ status: "failed" });

    // Retrying a processed message appends a new revision (quote lane now).
    const created2 = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture({ sourceMessageId: "src-retry-2" }));
    const retry2 = await request(app.getHttpServer())
      .post(`/messages/${created2.body.messageId}/retry-processing`)
      .set("Cookie", cookie);
    expect(retry2.status).toBe(201);
    expect(retry2.body).toMatchObject({ status: "ready", lane: "quote" });
    expect(retry2.body.revisionId).toEqual(expect.any(String));
  });

  it("returns 404 retrying an unknown message", async () => {
    const cookie = await loginCookie();
    const response = await request(app.getHttpServer())
      .post("/messages/ulid-nope/retry-processing")
      .set("Cookie", cookie);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("returns 404 for an unknown conversation id", async () => {
    const cookie = await loginCookie();
    const response = await request(app.getHttpServer())
      .get("/threads/ulid-nope")
      .set("Cookie", cookie);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("serves a FAQ thread with the proposed draft and the fact ids used", async () => {
    // A FAQ fixture: "hours" and "areas" match kb_hours and kb_areas.
    const received = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(
        fixture({
          sourceMessageId: "src-faq",
          subject: "Your hours and areas",
          text: "What are your opening hours and areas?",
          html: undefined,
        }),
      );
    expect(received.status).toBe(201);
    expect(received.body.processing).toBe("ready");

    const cookie = await loginCookie();
    const thread = await request(app.getHttpServer())
      .get(`/threads/${received.body.conversationId}`)
      .set("Cookie", cookie);
    expect(thread.status).toBe(200);
    expect(thread.body.processing).toMatchObject({
      status: "ready",
      lane: "faq",
    });
    // The draft section: proposed status, grounded body, fact ids used.
    expect(thread.body.draft).toMatchObject({
      status: "proposed",
      factIds: ["kb_areas", "kb_hours"],
      assumptions: [],
    });
    expect(thread.body.draft.revisionId).toEqual(expect.any(String));
    expect(thread.body.draft.bodyText).toContain(
      "We serve Balmain, Rozelle, Lilyfield, Birchgrove, and Mort Bay.",
    );
    expect(thread.body.draft.bodyText).toContain(
      "We clean Monday to Friday, 8am to 5pm, and Saturdays 9am to 1pm.",
    );
    // Fact-id order: the areas text (kb_areas) comes before hours.
    const areasAt = thread.body.draft.bodyText.indexOf("We serve Balmain");
    const hoursAt = thread.body.draft.bodyText.indexOf("We clean Monday");
    expect(areasAt).toBeLessThan(hoursAt);
  });
});

describe("IngressGuard with an unset key", () => {
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: `Bearer ${INGRESS_KEY}` },
      }),
    }),
  } as unknown as ExecutionContext;

  it("rejects all ingress with 401 and warns once", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const guard = new IngressGuard(
        new TimingSafeIngressKeyComparer(undefined),
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      }
      const logged = stdout.mock.calls.map((call) => String(call[0])).join("");
      expect(logged.match(/BOS_INGRESS_KEY is not set/g)).toHaveLength(1);
      expect(logged).not.toContain(INGRESS_KEY);
    } finally {
      stdout.mockRestore();
    }
  });
});

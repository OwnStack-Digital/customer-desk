import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../../app.module";
import {
  createPersistenceClient,
  type SqliteDb,
} from "../../outbound/persistence/client";
import { TimingSafeIngressKeyComparer } from "../../outbound/security/ingress-key-comparer";
import { IngressGuard } from "./ingress.guard";

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

  it("stores a new email: 201 with ids and processing pending", async () => {
    const response = await request(app.getHttpServer())
      .post("/inbound/emails")
      .set("Authorization", `Bearer ${INGRESS_KEY}`)
      .send(fixture());
    expect(response.status).toBe(201);
    expect(response.body.messageId).toEqual(expect.any(String));
    expect(response.body.conversationId).toEqual(expect.any(String));
    expect(response.body.duplicate).toBe(false);
    expect(response.body.processing).toBe("pending");
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
      processing: "pending",
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

  it("lists the fixtures newest first and serves the thread", async () => {
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
    expect(newest.processing).toBe("pending");
    expect(newest.urgent).toBe(false);
    expect(newest.automationPaused).toBe(false);
    expect(newest.preview).toBe("Hi, how much for an oven clean?");
    expect(newest.subject).toBe("Oven clean");
    expect(newest.lane).toBeUndefined();
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
    expect(thread.body.processing).toBeUndefined();
    expect(thread.body.draft).toBeUndefined();
  });

  it("returns 404 for an unknown conversation id", async () => {
    const cookie = await loginCookie();
    const response = await request(app.getHttpServer())
      .get("/threads/ulid-nope")
      .set("Cookie", cookie);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
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

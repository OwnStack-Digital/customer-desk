import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../../app.module";
import type { PriceList } from "../../../../core/domain/config";
import { buildQuote } from "../../../../core/domain/pricing";
import {
  createPersistenceClient,
  type PersistenceClient,
  type SqliteDb,
} from "../../../outbound/persistence/client";
import { sqliteOutboxEntries } from "../../../outbound/persistence/schema";

// apps/backend/src/adapters/inbound/http/acceptance -> repo root (config/ lives there).
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..", "..");
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

interface Ingested {
  conversationId: string;
  messageId: string;
  processing: string;
}

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

/** The committed sample price list (what the app itself booted with). */
function priceList(): PriceList {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "config", "price-list.json"), "utf-8"),
  ) as PriceList;
}

function knowledgeBaseIds(): string[] {
  const parsed = JSON.parse(
    readFileSync(join(REPO_ROOT, "config", "knowledge-base.json"), "utf-8"),
  ) as { blocks: Array<{ id: string }> };
  return parsed.blocks.map((block) => block.id);
}

beforeAll(async () => {
  dbFile = join(mkdtempSync(join(tmpdir(), "bos-golden-path-")), "test.db");
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
  expect(login.status).toBe(200);
  return login.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
}

/** Posts one normalized fixture through the ingress route. */
async function ingest(
  sourceMessageId: string,
  overrides: Record<string, unknown> = {},
): Promise<Ingested> {
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
  return response.body as Ingested;
}

async function threadOf(cookie: string, conversationId: string) {
  const response = await request(app.getHttpServer())
    .get(`/threads/${conversationId}`)
    .set("Cookie", cookie);
  expect(response.status).toBe(200);
  return response.body;
}

async function approveAndSend(cookie: string, conversationId: string) {
  const thread = await threadOf(cookie, conversationId);
  const revisionId = (thread.draft as { revisionId: string }).revisionId;
  const approved = await request(app.getHttpServer())
    .post(`/threads/${conversationId}/drafts/${revisionId}`)
    .set("Cookie", cookie)
    .send({ action: "approve" });
  expect(approved.status).toBe(201);
  const sent = await request(app.getHttpServer())
    .post(`/drafts/${revisionId}/send`)
    .set("Cookie", cookie)
    .send({ revisionId });
  expect(sent.status).toBe(200);
  return { revisionId, sent: sent.body as { messageId: string } };
}

/** Every outbox row, straight from the fresh database. */
async function outboxRows() {
  return db.select().from(sqliteOutboxEntries);
}

/**
 * The demonstrator golden path (docs/PLAN.md "Demonstrator gate", items
 * 2–7) on a fresh SQLite database, end to end over HTTP. Item 1 (phone-
 * width rendering) is design-verified: the web thread/inbox pages use
 * mobile-first inline styles at a 390px-friendly max width.
 */
describe("demonstrator golden path (gate items 2-7)", () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await loginCookie();
  });

  it("gate 2: posted fixtures for every lane are classified and visible; failures stay visible", async () => {
    const lanes: Array<[string, string, Record<string, unknown>]> = [
      [
        "faq",
        "ready",
        { subject: "Hours and areas", text: "What are your hours and areas?" },
      ],
      ["quote", "ready", { text: "How much for an oven clean?" }],
      [
        "service",
        "ready",
        { subject: "[bos:service] Book", text: "Can we book a clean?" },
      ],
      [
        "complaint",
        "needs_human",
        { subject: "Terrible", text: "I am unhappy and want a refund." },
      ],
      // A quote reply with no sent quote on its fresh conversation: even
      // a clear accept has zero candidates, so it is a human item — but
      // the lane is still classified and visible in the inbox.
      [
        "quote_reply",
        "needs_human",
        { subject: "[bos:quote_reply] Accept", text: "I accept the quote." },
      ],
      [
        "other",
        "needs_human",
        { subject: "[bos:other] Hello", text: "Just saying hi." },
      ],
      [
        "noise",
        "ready",
        { subject: "[bos:noise] Bounce", text: "mailer-daemon bounce" },
      ],
    ];
    const ingested: Ingested[] = [];
    for (const [lane, status, overrides] of lanes) {
      const result = await ingest(`src-gp-${lane}`, overrides);
      expect(result.processing).toBe(status);
      ingested.push(result);
    }
    // The fail lane: processing fails, the receipt still returns 201 and
    // the row stays visible in the inbox as `failed`.
    const failed = await ingest("src-gp-fail", {
      subject: "[bos:fail] anything",
      text: "This will time out.",
    });
    expect(failed.processing).toBe("failed");
    ingested.push(failed);

    const inbox = await request(app.getHttpServer())
      .get("/inbox")
      .set("Cookie", cookie);
    expect(inbox.status).toBe(200);
    const items = inbox.body.items as Array<{
      conversationId: string;
      lane?: string;
      processing: string;
      urgent: boolean;
    }>;
    for (const result of ingested) {
      const item = items.find(
        (candidate) => candidate.conversationId === result.conversationId,
      );
      expect(
        item,
        `conversation ${result.conversationId} visible`,
      ).toBeDefined();
      expect(item?.processing).toBe(result.processing);
    }
    const lanesSeen = items.map((item) => item.lane).sort();
    expect(lanesSeen).toContain("faq");
    expect(lanesSeen).toContain("quote");
    expect(lanesSeen).toContain("service");
    expect(lanesSeen).toContain("complaint");
    expect(lanesSeen).toContain("quote_reply");
    expect(lanesSeen).toContain("other");
    expect(lanesSeen).toContain("noise");
    // The failure stays visible.
    const failedItem = items.find(
      (item) => item.conversationId === failed.conversationId,
    );
    expect(failedItem?.processing).toBe("failed");
  });

  it("gate 3: FAQ drafts cite only knowledge-block fact ids; quote totals match buildQuote", async () => {
    // FAQ: fact ids are a subset of the configured knowledge-base ids.
    const faq = await ingest("src-gp-faq-grounded", {
      subject: "Hours",
      text: "What are your hours and areas?",
    });
    const faqThread = await threadOf(cookie, faq.conversationId);
    const faqDraft = faqThread.draft as {
      factIds?: string[];
      bodyText: string;
    };
    expect(faqDraft.factIds?.length).toBeGreaterThan(0);
    const kbIds = knowledgeBaseIds();
    for (const factId of faqDraft.factIds ?? []) {
      expect(kbIds).toContain(factId);
    }
    // Every non-wrapper body line is a configured block text (grounded).
    const wrappers = new Set(["Hi,", "Thanks,"]);
    const kb = JSON.parse(
      readFileSync(join(REPO_ROOT, "config", "knowledge-base.json"), "utf-8"),
    ) as { blocks: Array<{ text: string }> };
    const blockTexts = new Set(kb.blocks.map((block) => block.text));
    for (const line of faqDraft.bodyText.split("\n\n")) {
      if (!wrappers.has(line)) {
        expect(blockTexts.has(line), `grounded line: ${line}`).toBe(true);
      }
    }

    // Quote: totals equal buildQuote on the committed price list.
    const quote = await ingest("src-gp-quote-totals", {
      text: "How much for a regular clean with 1 bedroom and an oven clean?",
    });
    const quoteThread = await threadOf(cookie, quote.conversationId);
    const quoteDraft = quoteThread.draft as {
      revisionId: string;
      totalMinor?: number;
      assumptions: string[];
    };
    const priced = buildQuote(priceList(), {
      lines: [
        { ruleId: "occupied_bedroom", label: "Bedroom clean", quantity: 1 },
        { ruleId: "oven_clean", label: "Oven clean" },
      ],
    });
    if (priced.kind !== "priceable") {
      throw new Error(`expected a priceable quote, got: ${priced.kind}`);
    }
    expect(quoteDraft.totalMinor).toBe(priced.totalMinor);
    expect(quoteDraft.assumptions).toEqual([...priced.assumptions]);
  });

  it("gate 4: approve then send creates one outbound message and one queued outbox row; a second send returns the same message", async () => {
    const quote = await ingest("src-gp-send", {
      text: "How much for an oven clean?",
    });
    const { revisionId, sent } = await approveAndSend(
      cookie,
      quote.conversationId,
    );
    const after = await outboxRows();
    const created = after.filter((row) => row.messageId === sent.messageId);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      status: "queued",
      messageId: sent.messageId,
      conversationId: quote.conversationId,
    });

    // A second send of the same revision returns the same message and
    // creates nothing new.
    const second = await request(app.getHttpServer())
      .post(`/drafts/${revisionId}/send`)
      .set("Cookie", cookie)
      .send({ revisionId });
    expect(second.status).toBe(200);
    expect(second.body.messageId).toBe(sent.messageId);
    expect(await outboxRows()).toHaveLength(after.length);
  });

  it("gate 5: public accept requires an explicit POST; GET leaves sent; conflicting POST is 409", async () => {
    const quote = await ingest("src-gp-public", {
      text: "How much for an oven clean?",
    });
    await approveAndSend(cookie, quote.conversationId);
    // The outbound body carries the accept link; extract the raw token
    // exactly the way a customer's mail reader would.
    const thread = await threadOf(cookie, quote.conversationId);
    const outbound = (thread.messages as Array<{ text?: string }>).find(
      (message) => message.text?.includes("/quote/"),
    );
    const rawToken = /\/quote\/([^\s]+)/.exec(outbound?.text ?? "")?.[1];
    expect(rawToken).toBeDefined();

    // GET displays the quote and never decides.
    const shown = await request(app.getHttpServer()).get(
      `/public/quotes/${rawToken}`,
    );
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ status: "sent", canDecide: true });

    // An explicit POST accepts.
    const accepted = await request(app.getHttpServer())
      .post(`/public/quotes/${rawToken}/decision`)
      .send({ decision: "accept" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ status: "accepted" });

    // A conflicting POST is 409.
    const conflicting = await request(app.getHttpServer())
      .post(`/public/quotes/${rawToken}/decision`)
      .send({ decision: "decline" });
    expect(conflicting.status).toBe(409);
  });

  it("gate 6a: complaint is urgent, has the fixed draft, and processing never queues an outbox row", async () => {
    const before = await outboxRows();
    const complaint = await ingest("src-gp-complaint-urgent", {
      subject: "Terrible service",
      text: "I am unhappy; the floor was damaged. I want a refund.",
    });
    expect(complaint.processing).toBe("needs_human");
    const thread = await threadOf(cookie, complaint.conversationId);
    expect(thread.processing).toMatchObject({
      lane: "complaint",
      status: "needs_human",
    });
    expect(thread.draft).toMatchObject({
      status: "proposed",
      bodyText: "Thanks — the owner will reply personally.",
    });
    const inbox = await request(app.getHttpServer())
      .get("/inbox")
      .set("Cookie", cookie);
    const item = (
      inbox.body.items as Array<{
        conversationId: string;
        urgent: boolean;
      }>
    ).find((row) => row.conversationId === complaint.conversationId);
    expect(item?.urgent).toBe(true);
    // No auto-send: the complaint fixture created no outbox row by itself.
    expect(await outboxRows()).toHaveLength(before.length);
  });

  it("gate 6b: a quote reply changes quote state only after the operator confirms", async () => {
    // Quote → approve → send: one sent quote on the conversation.
    const quote = await ingest("src-gp-quote-reply", {
      text: "How much for an oven clean?",
    });
    const { revisionId } = await approveAndSend(cookie, quote.conversationId);
    const sentThread = await threadOf(cookie, quote.conversationId);
    const quoteVersionId = (sentThread.openQuote as { quoteVersionId: string })
      .quoteVersionId;

    // The customer replies "I accept".
    const reply = await ingest("src-gp-quote-reply-in", {
      messageId: "<gp-reply-1@customer.example>",
      inReplyTo: `<${revisionId}@harbourandpine.example>`,
      subject: "Re: Oven clean",
      text: "Thanks, I accept the quote.",
      // Far-future receipt so the reply is the conversation's latest message.
      receivedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(reply.conversationId).toBe(quote.conversationId);
    expect(reply.processing).toBe("ready");

    // The reply alone did not decide the quote.
    const beforeConfirm = await threadOf(cookie, quote.conversationId);
    expect(beforeConfirm.openQuote).toMatchObject({
      quoteVersionId,
      status: "sent",
    });
    expect(beforeConfirm.quoteReply).toMatchObject({
      intent: "accept",
      candidateQuoteVersionIds: [quoteVersionId],
    });

    // The operator confirms through the session-guarded endpoint.
    const confirmed = await request(app.getHttpServer())
      .post(`/threads/${quote.conversationId}/quote-decision`)
      .set("Cookie", cookie)
      .send({ quoteVersionId, decision: "accept" });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({
      kind: "confirmed",
      status: "accepted",
    });

    // And only then the quote state changed.
    const afterConfirm = await threadOf(cookie, quote.conversationId);
    // The decided version no longer appears as the open quote, but the
    // owner thread still shows the recorded decision.
    expect(afterConfirm.openQuote).toBeUndefined();
    expect(afterConfirm.quote).toMatchObject({
      quoteVersionId,
      status: "accepted",
      decision: "accept",
    });
  });
});

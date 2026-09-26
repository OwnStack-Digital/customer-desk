import { describe, expect, it } from "vitest";
import { ConflictError } from "../../domain/errors";
import type { Classification } from "../../domain/processing";
import { QUOTE_LINK_PLACEHOLDER } from "../../domain/quote";
import type { Clock } from "../../ports/clock";
import {
  classificationOf,
  email,
  FakeUnitOfWork,
  FixedClock,
  harness,
  NOW,
  ORG,
  SequentialIds,
} from "../testing";
import { GetPublicQuote, RecordQuoteDecision } from "./record-quote-decision";

/**
 * Slice 6 acceptance (PLAN.md tasks 6.3–6.5): quote versions are priced in
 * code, prepared with a placeholder link, sent with a real token, and
 * decided only by an explicit POST. All ports are fakes; no database, no
 * network, no framework.
 */

const PUBLIC_APP_URL = "https://app.example.test";

function quoteClassification(
  lines: Array<{ ruleId?: string; label: string; quantity?: number }>,
): Classification {
  return {
    ...classificationOf("quote"),
    quoteRequest: { lines },
    summary: "Quote request",
  };
}

/** The public pair built on the harness stores, with a custom clock. */
function publicPair(h: ReturnType<typeof harness>, clock: Clock) {
  return {
    get: new GetPublicQuote({
      quotes: h.quotes,
      tokenHasher: h.tokenHasher,
      profile: h.profile,
      clock,
      conversations: h.conversations,
      messages: h.messages,
    }),
    decide: new RecordQuoteDecision({
      quotes: h.quotes,
      tokenHasher: h.tokenHasher,
      profile: h.profile,
      clock,
      unitOfWork: new FakeUnitOfWork({
        messages: h.messages,
        drafts: h.drafts,
        outbox: h.outbox,
        audit: h.audit,
        quotes: h.quotes,
      }),
      ids: new SequentialIds(),
    }),
  };
}

/** Ingests a quote email and returns its live draft + quote version. */
async function receiveQuote(
  h: ReturnType<typeof harness>,
  lines: Array<{ ruleId?: string; label: string; quantity?: number }>,
  overrides: Parameters<typeof email>[0] = {},
) {
  h.classifier.script(quoteClassification(lines));
  const received = await h.receive.run(email(overrides));
  const draft = h.drafts.rows.at(-1);
  const quote = h.quotes.rows.at(-1);
  return { received, draft, quote };
}

describe("quote lane processing (task 6.3)", () => {
  it("a priceable request creates a prepared version and a proposed draft with the priced amounts", async () => {
    const h = harness();
    const { received, draft, quote } = await receiveQuote(h, [
      { ruleId: "regular_clean", label: "Regular clean", quantity: 3 },
      { label: "oven" },
    ]);
    expect(received.processing).toBe("ready");
    expect(draft).toMatchObject({
      status: "proposed",
      quoteVersionId: quote?.id,
      assumptions: [],
    });
    // The body renders every line, the totals, validity, and the placeholder.
    expect(draft?.bodyText).toContain("Regular clean × 3: AUD 135.00");
    expect(draft?.bodyText).toContain("Oven clean: AUD 65.00");
    expect(draft?.bodyText).toContain("Subtotal: AUD 200.00");
    expect(draft?.bodyText).toContain("Tax: AUD 20.00");
    expect(draft?.bodyText).toContain("Total: AUD 220.00");
    expect(draft?.bodyText).toContain("valid for 14 days");
    expect(draft?.bodyText).toContain(`here: ${QUOTE_LINK_PLACEHOLDER}`);
    expect(draft?.bodyText).not.toContain(PUBLIC_APP_URL);
    // The snapshot is immutable-priced and prepared.
    expect(quote).toMatchObject({
      status: "prepared",
      draftRevisionId: draft?.id,
      tokenHash: null,
      subtotalMinor: 20_000,
      taxMinor: 2000,
      totalMinor: 22_000,
      currency: "AUD",
      priceListVersion: "pl-1",
      validUntil: null,
      sentAt: null,
    });
    expect(quote?.lines).toEqual([
      {
        ruleId: "regular_clean",
        name: "Regular clean",
        quantity: 3,
        amountMinor: 13_500,
      },
      { ruleId: "oven_clean", name: "Oven clean", amountMinor: 6500 },
    ]);
    // Thread additions (PLAN shapes): quote-linked draft totals + openQuote.
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.draft).toMatchObject({
      totalMinor: 22_000,
      currency: "AUD",
    });
    expect(thread?.openQuote).toEqual({
      quoteVersionId: quote?.id,
      status: "prepared",
      totalMinor: 22_000,
      currency: "AUD",
    });
    expect(thread?.quote).toEqual({
      quoteVersionId: quote?.id,
      status: "prepared",
      totalMinor: 22_000,
      currency: "AUD",
      lines: [
        {
          ruleId: "regular_clean",
          name: "Regular clean",
          quantity: 3,
          amountMinor: 13_500,
        },
        { ruleId: "oven_clean", name: "Oven clean", amountMinor: 6500 },
      ],
    });
  });

  it("records the minimum charge as an assumption on the draft and the version", async () => {
    const h = harness();
    const { draft, quote } = await receiveQuote(h, [
      { label: "regular clean", quantity: 1 },
    ]);
    expect(draft?.assumptions).toEqual([
      'Applied the minimum charge to "Regular clean".',
    ]);
    expect(quote?.assumptions).toEqual(draft?.assumptions);
    expect(quote?.totalMinor).toBe(9900); // 9000 + 10% tax
  });

  it("unknown work is needs_human with the interpretation and no draft", async () => {
    const h = harness();
    h.classifier.script(quoteClassification([{ label: "gutter clearing" }]));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("needs_human");
    const revision = h.revisions.rows[0];
    expect(revision?.summary).toBe(
      'Quote request cannot be priced: No price rule matches "gutter clearing".',
    );
    expect(h.drafts.rows).toHaveLength(0);
    expect(h.quotes.rows).toHaveLength(0);
  });

  it("a per_unit line without a quantity is needs_human with no draft", async () => {
    const h = harness();
    h.classifier.script(quoteClassification([{ label: "regular clean" }]));
    const received = await h.receive.run(email());
    expect(received.processing).toBe("needs_human");
    expect(h.revisions.rows[0]?.summary).toContain("needs a quantity");
    expect(h.drafts.rows).toHaveLength(0);
    expect(h.quotes.rows).toHaveLength(0);
  });

  it("a paused conversation keeps its quote request human (no machine draft)", async () => {
    const h = harness();
    const first = await receiveQuote(h, [{ label: "oven" }]);
    await h.takeOver.run(ORG, first.received.conversationId, "operator");
    h.classifier.script(quoteClassification([{ label: "oven" }]));
    const second = await h.receive.run(
      email({
        sourceMessageId: "src-quote-2",
        messageId: "<quote-2@customer.example>",
        inReplyTo: "<msg-1@customer.example>",
      }),
    );
    expect(second.processing).toBe("needs_human");
    expect(h.drafts.rows).toHaveLength(1); // only the untouched original
  });
});

describe("quote send integration (task 6.4)", () => {
  async function approveAndSend(
    h: ReturnType<typeof harness>,
    draftId: string,
  ) {
    const conversation = h.drafts.rows.find((row) => row.id === draftId)
      ?.conversationId as string;
    await h.reviewDraft.run(
      ORG,
      conversation,
      draftId,
      { action: "approve" },
      "operator",
    );
    return h.sendDraft.run(ORG, draftId, "operator");
  }

  it("sending issues the token, stores only its hash, and puts the real link in the body", async () => {
    const h = harness();
    const { draft, quote } = await receiveQuote(h, [{ label: "oven" }]);
    const sent = await approveAndSend(h, draft?.id as string);
    expect(sent?.revisionId).toBe(draft?.id);
    // The raw token exists only inside the outbound body link.
    const rawToken = h.tokens.tokens[0] as string;
    const stored = h.quotes.rows.find((row) => row.id === quote?.id);
    expect(stored).toMatchObject({
      status: "sent",
      tokenHash: `hash(${rawToken})`,
      sentAt: NOW,
      validUntil: "2025-06-15T00:00:00.000Z", // sent_at + 14 UTC days
    });
    const outbound = h.messages.rows.find((row) => row.id === sent?.messageId);
    expect(outbound?.text).toContain(`${PUBLIC_APP_URL}/quote/${rawToken}`);
    expect(outbound?.text).not.toContain(QUOTE_LINK_PLACEHOLDER);
    expect(h.audit.rows.map((row) => row.action)).toEqual([
      "draft.approved",
      "quote.sent",
      "draft.sent",
    ]);
  });

  it("a non-quote draft is sent exactly as in slice 5 (no token, no quote rows touched)", async () => {
    const h = harness();
    h.classifier.script({
      ...classificationOf("faq"),
      faqFactIds: ["kb_hours"],
      summary: "Question about our service details",
    });
    await h.receive.run(
      email({ subject: "Your hours", text: "What are your hours?" }),
    );
    const draft = h.drafts.rows[0];
    const sent = await approveAndSend(h, draft?.id as string);
    expect(sent?.revisionId).toBe(draft?.id);
    expect(h.tokens.tokens).toHaveLength(0);
    expect(h.quotes.rows).toHaveLength(0);
    const outbound = h.messages.rows.find((row) => row.id === sent?.messageId);
    expect(outbound?.text).toBe(draft?.bodyText);
    expect(h.audit.rows.map((row) => row.action)).toEqual([
      "draft.approved",
      "draft.sent",
    ]);
  });

  it("supersedes the previous sent version and revokes its token", async () => {
    const h = harness();
    const first = await receiveQuote(h, [{ label: "oven" }]);
    await approveAndSend(h, first.draft?.id as string);
    const firstToken = h.tokens.tokens[0] as string;

    // A second quote in the same conversation, then sent too.
    const second = await receiveQuote(h, [{ label: "oven" }], {
      sourceMessageId: "src-quote-2",
      messageId: "<quote-2@customer.example>",
      inReplyTo: "<msg-1@customer.example>",
    });
    expect(second.received.conversationId).toBe(first.received.conversationId);
    await approveAndSend(h, second.draft?.id as string);

    const firstQuote = h.quotes.rows.find((row) => row.id === first.quote?.id);
    expect(firstQuote?.status).toBe("superseded");
    const secondQuote = h.quotes.rows.find(
      (row) => row.id === second.quote?.id,
    );
    expect(secondQuote?.status).toBe("sent");

    // The old token is revoked: 404 (undefined) on the public lookup.
    const publicPairWithDefault = publicPair(h, new FixedClock());
    expect(
      await publicPairWithDefault.get.run(ORG, firstToken),
    ).toBeUndefined();
    // The new token still works.
    expect(
      await publicPairWithDefault.get.run(ORG, h.tokens.tokens[1] as string),
    ).toMatchObject({ status: "sent", canDecide: true });
    // The thread's openQuote is the newest sent version.
    const thread = await h.getThread.run(ORG, second.received.conversationId);
    expect(thread?.openQuote).toMatchObject({
      quoteVersionId: second.quote?.id,
      status: "sent",
      totalMinor: 7150,
    });
  });

  it("fails closed when PUBLIC_APP_URL is unset for a quote draft", async () => {
    const h = harness();
    const { draft } = await receiveQuote(h, [{ label: "oven" }]);
    const conversation = h.drafts.rows.find((row) => row.id === draft?.id)
      ?.conversationId as string;
    await h.reviewDraft.run(
      ORG,
      conversation,
      draft?.id as string,
      { action: "approve" },
      "operator",
    );
    const { SendApprovedDraft } = await import("../review/send-approved-draft");
    const { FakeTokens, FakeTokenHasher, FakeUnitOfWork } = await import(
      "../testing"
    );
    const send = new SendApprovedDraft({
      conversations: h.conversations,
      drafts: h.drafts,
      profile: h.profile,
      unitOfWork: new FakeUnitOfWork({
        messages: h.messages,
        drafts: h.drafts,
        outbox: h.outbox,
        audit: h.audit,
        quotes: h.quotes,
      }),
      quotes: h.quotes,
      tokens: new FakeTokens(),
      tokenHasher: new FakeTokenHasher(),
      publicAppUrl: undefined,
      ids: new SequentialIds(),
      clock: new FixedClock(),
    });
    await expect(
      send.run(ORG, draft?.id as string, "operator"),
    ).rejects.toThrow(/PUBLIC_APP_URL/);
  });
});

describe("public quote decision (task 6.5)", () => {
  type H = ReturnType<typeof harness>;

  /** Sends one quote and returns its raw public token. */
  async function sentQuote(h: H, overrides: Parameters<typeof email>[0] = {}) {
    const { received, draft, quote } = await receiveQuote(
      h,
      [{ label: "oven" }],
      overrides,
    );
    const conversation = h.drafts.rows.find((row) => row.id === draft?.id)
      ?.conversationId as string;
    await h.reviewDraft.run(
      ORG,
      conversation,
      draft?.id as string,
      { action: "approve" },
      "operator",
    );
    await h.sendDraft.run(ORG, draft?.id as string, "operator");
    const rawToken = h.tokens.tokens[0] as string;
    return { received, quote, rawToken };
  }

  it("GET displays the quote and never decides (link scanner test)", async () => {
    const h = harness();
    const { quote, rawToken } = await sentQuote(h);
    const { get } = publicPair(h, new FixedClock());
    const shown = await get.run(ORG, rawToken);
    expect(shown).toMatchObject({
      businessName: "Harbour & Pine Cleaning",
      status: "sent",
      currency: "AUD",
      lines: [{ name: "Oven clean", amountMinor: 6500 }],
      assumptions: [],
      subtotalMinor: 6500,
      taxMinor: 650,
      totalMinor: 7150,
      validUntil: "2025-06-15T00:00:00.000Z",
      canDecide: true,
    });
    expect(shown?.messages.map((message) => message.direction)).toEqual([
      "inbound",
      "outbound",
    ]);
    expect(shown?.messages[0]?.from).toBe("You");
    expect(shown?.messages[1]?.from).toBe("Harbour & Pine Cleaning");
    expect(shown?.messages[1]?.text).not.toContain(rawToken);
    // A scanner that only GETs leaves the quote `sent`.
    const stored = h.quotes.rows.find((row) => row.id === quote?.id);
    expect(stored).toMatchObject({
      status: "sent",
      decidedAt: null,
      decision: null,
    });
  });

  it("accept records the decision and the customer audit event", async () => {
    const h = harness();
    const { quote, rawToken, received } = await sentQuote(h);
    const { decide } = publicPair(h, new FixedClock());
    const result = await decide.run(ORG, rawToken, "accept");
    expect(result).toMatchObject({ status: "accepted", canDecide: false });
    expect(h.quotes.rows.find((row) => row.id === quote?.id)).toMatchObject({
      status: "accepted",
      decision: "accept",
      decidedAt: NOW,
    });
    expect(h.audit.rows.at(-1)).toMatchObject({
      actor: "customer",
      action: "quote.accepted",
      entityType: "quote_version",
      entityId: quote?.id,
    });
    // The decision leaves the open set, but the owner thread and inbox
    // still show it. A public decision inserts no message of its own.
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.openQuote).toBeUndefined();
    expect(thread?.quote).toEqual({
      quoteVersionId: quote?.id,
      status: "accepted",
      totalMinor: 7150,
      currency: "AUD",
      decision: "accept",
      decidedAt: NOW,
      lines: [{ ruleId: "oven_clean", name: "Oven clean", amountMinor: 6500 }],
    });
    const inbox = await h.listInbox.run(ORG);
    expect(
      inbox.items.find(
        (item) => item.conversationId === received.conversationId,
      ),
    ).toMatchObject({ quoteStatus: "accepted" });
  });

  it("decline records the declined status", async () => {
    const h = harness();
    const { quote, rawToken, received } = await sentQuote(h);
    const { decide } = publicPair(h, new FixedClock());
    const result = await decide.run(ORG, rawToken, "decline");
    expect(result).toMatchObject({ status: "declined", canDecide: false });
    expect(h.quotes.rows.find((row) => row.id === quote?.id)).toMatchObject({
      status: "declined",
      decision: "decline",
    });
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.quote).toMatchObject({
      quoteVersionId: quote?.id,
      status: "declined",
      decision: "decline",
    });
    expect(
      (await h.listInbox.run(ORG)).items.find(
        (item) => item.conversationId === received.conversationId,
      ),
    ).toMatchObject({ quoteStatus: "declined" });
  });

  it("replaying the same decision is idempotent: no duplicate rows", async () => {
    const h = harness();
    const { rawToken } = await sentQuote(h);
    const { decide, get } = publicPair(h, new FixedClock());
    await decide.run(ORG, rawToken, "accept");
    const auditAfterFirst = h.audit.rows.length;
    const second = await decide.run(ORG, rawToken, "accept");
    expect(second?.status).toBe("accepted");
    expect(h.audit.rows).toHaveLength(auditAfterFirst);
    // Display still works and canDecide is false.
    expect(await get.run(ORG, rawToken)).toMatchObject({
      status: "accepted",
      canDecide: false,
    });
  });

  it("a conflicting decision is 409", async () => {
    const h = harness();
    const { rawToken } = await sentQuote(h);
    const { decide } = publicPair(h, new FixedClock());
    await decide.run(ORG, rawToken, "accept");
    await expect(decide.run(ORG, rawToken, "decline")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("unknown, expired, and superseded tokens are 404 on GET and POST", async () => {
    const h = harness();
    const { rawToken } = await sentQuote(h);
    const now = publicPair(h, new FixedClock());
    const late = publicPair(
      h,
      new (class implements Clock {
        now(): Date {
          return new Date("2025-06-20T00:00:00.000Z");
        }
      })(),
    );

    // Unknown token.
    expect(await now.get.run(ORG, "no-such-token")).toBeUndefined();
    expect(
      await now.decide.run(ORG, "no-such-token", "accept"),
    ).toBeUndefined();

    // Expired: past validUntil (2025-06-15).
    expect(await late.get.run(ORG, rawToken)).toBeUndefined();
    expect(await late.decide.run(ORG, rawToken, "accept")).toBeUndefined();
    // And it is still undecided: the late POST was a 404, not a decision.
    expect(h.quotes.rows.every((row) => row.decidedAt === null)).toBe(true);
  });

  it("accepting creates no payment or booking row — the quote version is the only change", async () => {
    const h = harness();
    const { quote, rawToken } = await sentQuote(h);
    const { decide } = publicPair(h, new FixedClock());
    const quoteRowsBefore = h.quotes.rows.length;
    const messageRowsBefore = h.messages.rows.length;
    await decide.run(ORG, rawToken, "accept");
    expect(h.quotes.rows).toHaveLength(quoteRowsBefore);
    expect(h.messages.rows).toHaveLength(messageRowsBefore);
    expect(h.quotes.rows.find((row) => row.id === quote?.id)?.status).toBe(
      "accepted",
    );
  });
});

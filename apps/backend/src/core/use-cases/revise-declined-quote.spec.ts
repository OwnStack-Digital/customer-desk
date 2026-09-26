import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../domain/errors";
import { ReviseDeclinedQuote } from "./revise-declined-quote";
import {
  classificationOf,
  email,
  FakeUnitOfWork,
  harness,
  ORG,
} from "./testing";

const OPERATOR = "owner@harbourandpine.example";

async function declinedQuote(h: ReturnType<typeof harness>) {
  h.classifier.script(classificationOf("quote"));
  const received = await h.receive.run(email());
  const draft = h.drafts.rows.at(-1);
  await h.reviewDraft.run(
    ORG,
    received.conversationId,
    draft?.id as string,
    { action: "approve" },
    OPERATOR,
  );
  await h.sendDraft.run(ORG, draft?.id as string, OPERATOR);
  await h.recordQuoteDecision.run(ORG, h.tokens.tokens[0] as string, "decline");
  return {
    conversationId: received.conversationId,
    declinedId: h.quotes.rows[0]?.id as string,
    token: h.tokens.tokens[0] as string,
  };
}

function reviser(h: ReturnType<typeof harness>) {
  let seq = 0;
  return new ReviseDeclinedQuote({
    conversations: h.conversations,
    quotes: h.quotes,
    drafts: h.drafts,
    messages: h.messages,
    priceList: h.priceList,
    profile: h.profile,
    drafter: h.drafter,
    unitOfWork: new FakeUnitOfWork({
      messages: h.messages,
      drafts: h.drafts,
      outbox: h.outbox,
      audit: h.audit,
      quotes: h.quotes,
    }),
    ids: { nextId: () => `rev-${++seq}` },
    clock: { now: () => new Date("2025-06-02T00:00:00.000Z") },
  });
}

describe("ReviseDeclinedQuote", () => {
  it("prepares a new priced quote and leaves the declined one declined", async () => {
    const h = harness();
    const { conversationId, declinedId, token } = await declinedQuote(h);

    const prepared = await reviser(h).run(
      ORG,
      conversationId,
      [
        { ruleId: "oven_clean", label: "Oven clean" },
        { ruleId: "regular_clean", label: "Regular clean", quantity: 2 },
      ],
      OPERATOR,
    );

    expect(prepared).toMatchObject({
      kind: "prepared",
      conversationId,
      currency: "AUD",
      totalMinor: 17_050, // oven 7150 + 2 bedrooms at the minimum 9900
    });
    expect(h.quotes.rows.find((row) => row.id === declinedId)?.status).toBe(
      "declined",
    );
    const thread = await h.getThread.run(ORG, conversationId);
    expect(thread?.openQuote).toMatchObject({ status: "prepared" });
    expect(thread?.quote?.status).toBe("prepared");
    expect(thread?.quotes.map((quote) => quote.status)).toEqual([
      "declined",
      "prepared",
    ]);
    expect(thread?.timeline.filter((entry) => entry.kind === "event")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "quote.declined",
          label: "Quote declined",
        }),
        expect.objectContaining({
          action: "quote.revised",
          label: "Updated quote prepared",
        }),
      ]),
    );
    expect(thread?.timeline.some((entry) => entry.kind === "received")).toBe(
      true,
    );
    expect(thread?.timeline.some((entry) => entry.kind === "sent")).toBe(true);
    expect(thread?.draft?.status).toBe("proposed");
    expect(thread?.draft?.bodyText).toContain("{{quoteLink}}");
    expect(h.audit.rows.at(-1)).toMatchObject({
      actor: OPERATOR,
      action: "quote.revised",
    });
    // The old link still shows the declined quote, not the new draft.
    expect(await h.getPublicQuote.run(ORG, token)).toMatchObject({
      status: "declined",
      canDecide: false,
    });
  });

  it("does not revise a quote that is still sent, or an unpriceable request", async () => {
    const h = harness();
    h.classifier.script(classificationOf("quote"));
    const received = await h.receive.run(email());
    const draft = h.drafts.rows.at(-1);
    await h.reviewDraft.run(
      ORG,
      received.conversationId,
      draft?.id as string,
      { action: "approve" },
      OPERATOR,
    );
    await h.sendDraft.run(ORG, draft?.id as string, OPERATOR);
    const revise = reviser(h);
    await expect(
      revise.run(
        ORG,
        received.conversationId,
        [{ ruleId: "oven_clean", label: "Oven clean" }],
        OPERATOR,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await h.recordQuoteDecision.run(
      ORG,
      h.tokens.tokens[0] as string,
      "decline",
    );
    await expect(
      revise.run(
        ORG,
        received.conversationId,
        [{ label: "gutter clearing" }],
        OPERATOR,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      h.quotes.rows.filter((row) => row.status === "prepared"),
    ).toHaveLength(0);
  });

  it("can be approved and sent as a new quote link", async () => {
    const h = harness();
    const { conversationId, declinedId } = await declinedQuote(h);
    const prepared = await reviser(h).run(
      ORG,
      conversationId,
      [{ ruleId: "oven_clean", label: "Oven clean" }],
      OPERATOR,
    );
    if (prepared.kind !== "prepared") {
      throw new Error("expected a prepared revision");
    }
    await h.reviewDraft.run(
      ORG,
      conversationId,
      prepared.revisionId,
      { action: "approve" },
      OPERATOR,
    );
    const sent = await h.sendDraft.run(ORG, prepared.revisionId, OPERATOR);
    expect(sent?.messageId).toBeDefined();
    expect(h.quotes.rows.find((row) => row.id === declinedId)?.status).toBe(
      "declined",
    );
    expect(
      h.quotes.rows.find((row) => row.id === prepared.quoteVersionId),
    ).toMatchObject({
      status: "sent",
    });
    expect(h.tokens.tokens).toHaveLength(2);
  });
});

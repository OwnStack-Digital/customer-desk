import { describe, expect, it } from "vitest";
import { ValidationError } from "../../domain/errors";
import { email, FakeUnitOfWork, harness, NOW, ORG } from "../testing";
import { InstructAssistant } from "./instruct-assistant";

const OPERATOR = "owner@harbourandpine.example";
let seq = 0;

function instructor(h: ReturnType<typeof harness>) {
  return new InstructAssistant({
    conversations: h.conversations,
    messages: h.messages,
    profile: h.profile,
    unitOfWork: new FakeUnitOfWork({
      messages: h.messages,
      drafts: h.drafts,
      outbox: h.outbox,
      audit: h.audit,
      quotes: h.quotes,
    }),
    processing: h.processing,
    ids: { nextId: () => `note-${++seq}` },
    clock: { now: () => new Date(NOW) },
  });
}

describe("InstructAssistant", () => {
  it("processes an owner instruction and does not email the customer", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    h.classifier.script({
      lane: "quote",
      confidence: "high",
      summary: "Owner asked for a 2 bedroom quote",
      quoteRequest: {
        lines: [
          { ruleId: "regular_clean", label: "Regular clean", quantity: 2 },
        ],
      },
    });
    const outboxBefore = h.outbox.rows.length;

    const noted = await instructor(h).run(
      ORG,
      received.conversationId,
      "  Quote 2 bedrooms, no oven.  ",
      OPERATOR,
    );

    expect(noted?.conversationId).toBe(received.conversationId);
    const stored = h.messages.rows.find((row) => row.id === noted?.messageId);
    expect(stored).toMatchObject({
      direction: "instruction",
      fromAddress: OPERATOR,
      text: "Quote 2 bedrooms, no oven.",
      to: [],
    });
    expect(h.outbox.rows).toHaveLength(outboxBefore);
    expect(h.classifier.calls.at(-1)).toMatchObject({
      operatorInstruction: true,
      email: { text: "Quote 2 bedrooms, no oven." },
    });
    expect(h.classifier.calls.at(-1)?.thread?.length).toBeGreaterThan(0);
    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.timeline.at(-1)).toMatchObject({
      kind: "instruction",
      text: "Quote 2 bedrooms, no oven.",
    });
    expect(thread?.draft?.bodyText).toContain("Regular clean");
  });

  it("still drafts after take-over, unlike a later customer email", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    await h.conversations.setAutomationPaused(
      ORG,
      received.conversationId,
      true,
    );
    h.classifier.script({
      lane: "faq",
      confidence: "high",
      summary: "Owner asked for hours",
      faqFactIds: ["kb_hours"],
    });

    await instructor(h).run(
      ORG,
      received.conversationId,
      "Answer with our hours.",
      OPERATOR,
    );

    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.draft?.factIds).toEqual(["kb_hours"]);
    expect(thread?.processing?.status).toBe("ready");
  });

  it("updates the quote from the latest customer ask even when the model parks it", async () => {
    const h = harness();
    const received = await h.receive.run(
      email({ text: "regular clean of 2 bedrooms" }),
    );
    h.classifier.script({
      lane: "other",
      confidence: "low",
      summary: "Owner instructs to update a quote.",
    });

    await instructor(h).run(
      ORG,
      received.conversationId,
      "can you update the quote",
      OPERATOR,
    );

    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.processing).toMatchObject({
      lane: "quote",
      status: "ready",
    });
    expect(thread?.draft?.bodyText).toContain("Regular clean × 2");
    expect(thread?.draft?.status).toBe("proposed");
    expect(
      h.drafts.rows.filter((row) => row.status === "proposed"),
    ).toHaveLength(1);
  });

  it("replaces the reply when the owner asks to focus on home cleaning", async () => {
    const h = harness();
    const received = await h.receive.run(email());
    h.classifier.script({
      lane: "other",
      confidence: "low",
      summary: "Instruction to focus on residential cleaning.",
    });

    await instructor(h).run(
      ORG,
      received.conversationId,
      "focus on residential cleans",
      OPERATOR,
    );

    const thread = await h.getThread.run(ORG, received.conversationId);
    expect(thread?.draft?.bodyText).toContain("We do home cleaning.");
    expect(thread?.draft?.bodyText).not.toContain("Oven clean");
  });

  it("rejects an empty instruction and an unknown conversation", async () => {
    const h = harness();
    await expect(
      instructor(h).run(ORG, "missing", "hello", OPERATOR),
    ).resolves.toBeUndefined();
    await expect(
      instructor(h).run(ORG, "missing", "   ", OPERATOR),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

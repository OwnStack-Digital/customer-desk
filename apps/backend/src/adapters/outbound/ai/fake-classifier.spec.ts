import { describe, expect, it } from "vitest";
import type { KnowledgeBase } from "../../../core/domain/config";
import { ClassifierError } from "../../../core/domain/processing";
import { FakeClassifier } from "./fake-classifier";

const KB: KnowledgeBase = {
  version: "kb-1",
  blocks: [
    { id: "kb_hours", tags: ["hours", "open"], text: "Mon-Fri 8-5." },
    { id: "kb_areas", tags: ["areas", "suburbs"], text: "Balmain, Rozelle." },
    {
      id: "kb_included",
      tags: ["included", "what is included"],
      text: "Vacuum, mop, dust.",
    },
    {
      id: "kb_booking",
      tags: ["booking", "how booking works"],
      text: "Reply with suburb and day.",
    },
  ],
};

const classifier = new FakeClassifier({
  getKnowledgeBase: () => KB,
});

/** Classifier input without an outbound-quote context by default. */
function input(
  subject: string | undefined,
  text = "",
  repliedToOutboundQuote = false,
) {
  return {
    email: { subject, text },
    repliedToOutboundQuote,
  };
}

describe("FakeClassifier rules (first match wins)", () => {
  it("rule 1: [bos:fail] throws a timeout-style error", async () => {
    await expect(
      classifier.classify(input("[bos:fail] anything")),
    ).rejects.toBeInstanceOf(ClassifierError);
  });

  it("rule 1: subject prefix forces the lane", async () => {
    const cases: Array<[string, string]> = [
      ["[bos:faq] plain", "faq"],
      ["[bos:quote] plain", "quote"],
      ["[bos:service] plain", "service"],
      ["[bos:complaint] plain", "complaint"],
      ["[bos:quote_reply] plain", "quote_reply"],
      ["[bos:other] plain", "other"],
      ["[bos:noise] plain", "noise"],
    ];
    for (const [subject, lane] of cases) {
      expect((await classifier.classify(input(subject))).lane).toBe(lane);
    }
  });

  it("rule 1: [bos:low] forces low confidence on the matched lane, else other", async () => {
    const low = await classifier.classify(
      input("[bos:low] what are your hours"),
    );
    expect(low).toMatchObject({ lane: "faq", confidence: "low" });
    const lowOther = await classifier.classify(input("[bos:low] hmm"));
    expect(lowOther).toMatchObject({ lane: "other", confidence: "low" });
  });

  it("rule 2: complaint words win over every other lane", async () => {
    const mixed = await classifier.classify(
      input("Quote and refund", "how much? I am unhappy"),
    );
    expect(mixed).toMatchObject({ lane: "complaint", confidence: "high" });
    for (const word of [
      "complaint",
      "unhappy",
      "refund",
      "terrible",
      "damaged",
    ]) {
      expect(
        (await classifier.classify(input(`Re: booking`, `please ${word} now`)))
          .lane,
      ).toBe("complaint");
    }
  });

  it("rule 3: a replied-to outbound quote is a quote_reply with intent words", async () => {
    const accept = await classifier.classify(
      input("Re: your quote", "I accept, thanks", true),
    );
    expect(accept).toMatchObject({
      lane: "quote_reply",
      quoteReply: { intent: "accept" },
    });
    const decline = await classifier.classify(
      input("Re: your quote", "we decline", true),
    );
    expect(decline.quoteReply?.intent).toBe("decline");
    const change = await classifier.classify(
      input("Re: your quote", "can we change the day", true),
    );
    expect(change.quoteReply?.intent).toBe("change");
    const unclear = await classifier.classify(
      input("Re: your quote", "hmm okay", true),
    );
    expect(unclear.quoteReply?.intent).toBe("unclear");
  });

  it("rule 3: quote words do not win when replying to an outbound quote", async () => {
    const result = await classifier.classify(
      input("Re: your quote", "how much was it again", true),
    );
    expect(result.lane).toBe("quote_reply");
  });

  it("rule 4: quote words", async () => {
    for (const text of ["quote please", "how much", "the price", "estimate"]) {
      expect((await classifier.classify(input("Hello", text))).lane).toBe(
        "quote",
      );
    }
  });

  it("rule 5: service words", async () => {
    for (const text of [
      "can we book",
      "reschedule please",
      "cancel the clean",
      "move the booking",
    ]) {
      expect((await classifier.classify(input("Hello", text))).lane).toBe(
        "service",
      );
    }
  });

  it("rule 6: FAQ words select fact ids whose KB tags match", async () => {
    const hours = await classifier.classify(input("hours?"));
    expect(hours).toMatchObject({
      lane: "faq",
      confidence: "high",
      faqFactIds: ["kb_hours"],
    });
    const both = await classifier.classify(input("areas and what is included"));
    expect(both.faqFactIds).toEqual(["kb_areas", "kb_included"]);
    const booking = await classifier.classify(input("how booking works"));
    expect(booking.faqFactIds).toEqual(["kb_booking"]);
  });

  it("rule 7: noise words park as noise", async () => {
    for (const text of ["mailer-daemon", "noreply", "unsubscribe"]) {
      expect((await classifier.classify(input("Automated", text))).lane).toBe(
        "noise",
      );
    }
  });

  it("rule 8: anything else is other at low confidence", async () => {
    expect(
      await classifier.classify(input("Hello", "just saying hi")),
    ).toMatchObject({ lane: "other", confidence: "low" });
  });

  it("complaint wins over quote words even mid-text (precedence)", async () => {
    const result = await classifier.classify(
      input("quote", "give me a price or a refund"),
    );
    expect(result.lane).toBe("complaint");
  });
});

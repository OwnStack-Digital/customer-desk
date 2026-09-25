import { describe, expect, it } from "vitest";
import type { FaqBlock } from "./drafting";
import { buildFaqBody, isDroppedWording, unknownLine } from "./drafting";

const BLOCKS: FaqBlock[] = [
  { id: "kb_hours", text: "We clean Monday to Friday, 8am to 5pm." },
  {
    id: "kb_areas",
    text: "We serve Balmain, Rozelle, and Lilyfield. Birchgrove too.",
  },
];

/**
 * Slice 4 renderer acceptance (PLAN.md task 4.3): drop rule per violation
 * class, fact-id ordering, unknown-line inclusion, and the sentence-level
 * grounding property — every non-wrapper sentence appears verbatim in a
 * selected knowledge block.
 */
describe("isDroppedWording (drop rule)", () => {
  it("keeps plain wrapper wording", () => {
    expect(isDroppedWording("Hi,")).toBe(false);
    expect(isDroppedWording("Thanks,")).toBe(false);
  });

  it("drops wording containing a digit", () => {
    expect(isDroppedWording("Hi, thanks for the 5-star clean")).toBe(true);
  });

  it.each(["$", "€", "£", "¥", "₩", "₹", "₽", "¢"])(
    "drops wording containing the currency symbol %s",
    (symbol) => {
      expect(isDroppedWording(`Hi${symbol}`)).toBe(true);
      expect(isDroppedWording(`That will be 50${symbol}`)).toBe(true);
    },
  );

  it.each(["guarantee", "booked", "paid", "fault", "sorry we"])(
    "drops wording containing the forbidden word %s",
    (word) => {
      expect(isDroppedWording(`We ${word} the visit.`)).toBe(true);
      expect(isDroppedWording(`We ${word.toUpperCase()} the visit.`)).toBe(
        true,
      );
    },
  );

  it("does not drop wording for words that merely contain safe text", () => {
    expect(isDroppedWording("Hello there,")).toBe(false);
  });
});

describe("buildFaqBody", () => {
  it("renders greeting + block texts + closing", () => {
    const body = buildFaqBody({
      greeting: "Hi,",
      closing: "Thanks,",
      blocks: [BLOCKS[0]],
      unknownTopics: [],
    });
    expect(body).toBe(
      "Hi,\n\nWe clean Monday to Friday, 8am to 5pm.\n\nThanks,",
    );
  });

  it("renders block texts in fact-id order regardless of input order", () => {
    const body = buildFaqBody({
      blocks: [BLOCKS[1], BLOCKS[0]], // kb_areas before kb_hours on purpose
      unknownTopics: [],
    });
    const hoursAt = body.indexOf(BLOCKS[0].text);
    const areasAt = body.indexOf(BLOCKS[1].text);
    expect(hoursAt).toBeGreaterThanOrEqual(0);
    expect(areasAt).toBeGreaterThanOrEqual(0);
    // "kb_hours" sorts before "kb_areas"? No: alphabetically kb_areas <
    // kb_hours, so the areas text must come first.
    expect(areasAt).toBeLessThan(hoursAt);
  });

  it("drops greeting and closing that violate the rule, keeps the body", () => {
    const body = buildFaqBody({
      greeting: "Hi, we guarantee the 5pm clean",
      closing: "Thanks, you're booked for $99",
      blocks: [BLOCKS[0]],
      unknownTopics: [],
    });
    expect(body).not.toContain("guarantee");
    expect(body).not.toContain("booked");
    expect(body).not.toContain("$");
    expect(body).toBe("We clean Monday to Friday, 8am to 5pm.");
  });

  it("drops only the violating wrapper, not the clean one", () => {
    const body = buildFaqBody({
      greeting: "Hi,",
      closing: "Sorry we missed you",
      blocks: [],
      unknownTopics: [],
    });
    expect(body).toBe("Hi,");
  });

  it("omits empty/whitespace wording without a blank line", () => {
    expect(
      buildFaqBody({
        greeting: "   ",
        closing: "",
        blocks: [BLOCKS[0]],
        unknownTopics: [],
      }),
    ).toBe("We clean Monday to Friday, 8am to 5pm.");
  });

  it("includes an explicit unknown line naming each missing topic", () => {
    const body = buildFaqBody({
      blocks: [BLOCKS[0]],
      unknownTopics: ["parking"],
    });
    expect(body).toContain(unknownLine("parking"));
    expect(body).toContain("We don't have that information yet about parking.");
  });

  it("grounding: every non-wrapper sentence appears verbatim in a selected block", () => {
    const body = buildFaqBody({
      greeting: "Hi,",
      closing: "Thanks,",
      blocks: BLOCKS,
      unknownTopics: ["parking"],
    });
    const lines = body.split("\n\n");
    const wrappers = new Set(["Hi,", "Thanks,", unknownLine("parking")]);
    const bodySentences = lines
      .filter((line) => !wrappers.has(line))
      .flatMap((line) => splitSentences(line));
    expect(bodySentences.length).toBeGreaterThan(0);
    for (const sentence of bodySentences) {
      expect(BLOCKS.some((block) => block.text.includes(sentence))).toBe(true);
    }
  });

  it("never invents content beyond blocks and the unknown line", () => {
    const body = buildFaqBody({ blocks: BLOCKS, unknownTopics: [] });
    for (const line of body.split("\n\n")) {
      expect(BLOCKS.some((block) => block.text === line)).toBe(true);
    }
  });
});

/** Sentence split on terminal punctuation followed by whitespace. */
function splitSentences(line: string): string[] {
  return line
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

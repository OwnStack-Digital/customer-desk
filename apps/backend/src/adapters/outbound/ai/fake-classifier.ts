import type { Lane } from "../../../core/domain/messaging";
import type {
  Classification,
  ClassifierInput,
} from "../../../core/domain/processing";
import { ClassifierError } from "../../../core/domain/processing";
import type { ClassifierPort } from "../../../core/ports/classifier";
import type { KnowledgeBaseRepository } from "../../../core/ports/knowledge-base-repository";

/**
 * Deterministic fake classifier (docs/PLAN.md "Fake classifier, first
 * match"). Rules apply strictly in order; the first match wins. It never
 * returns prices, tax, or a permission to send — only classification
 * slots. Complaint words override every other lane; low confidence never
 * parks as noise.
 */

/** Subject prefixes that force a lane, a failure, or low confidence. */
const PREFIXES: Record<string, Lane> = {
  "[bos:faq]": "faq",
  "[bos:quote]": "quote",
  "[bos:service]": "service",
  "[bos:complaint]": "complaint",
  "[bos:quote_reply]": "quote_reply",
  "[bos:other]": "other",
  "[bos:noise]": "noise",
};

const COMPLAINT_WORDS = [
  "complaint",
  "unhappy",
  "refund",
  "terrible",
  "damaged",
];
const QUOTE_WORDS = ["quote", "how much", "price", "estimate"];
const SERVICE_WORDS = ["book", "reschedule", "cancel the", "move the"];
const FAQ_WORDS = ["hours", "areas", "included", "how booking"];
const NOISE_WORDS = ["mailer-daemon", "noreply", "unsubscribe"];

/** Fake service artifact; internal note data only, never a draft. */
const SERVICE_NOTE = {
  supplied: [] as string[],
  missing: [] as string[],
  nextAction: "Reply to the customer to arrange the service.",
};

export class FakeClassifier implements ClassifierPort {
  constructor(private readonly knowledgeBase: KnowledgeBaseRepository) {}

  async classify(input: ClassifierInput): Promise<Classification> {
    const haystack = [input.email.subject ?? "", input.email.text ?? ""]
      .join("\n")
      .toLowerCase();
    const subject = input.email.subject ?? "";

    // Rule 1: subject prefix wins. `fail` throws; `low` forces low
    // confidence on whatever the rest of the subject would be, else other.
    const forcedLow = subject.startsWith("[bos:low]");
    const prefix = Object.keys(PREFIXES).find((tag) => subject.startsWith(tag));
    if (subject.startsWith("[bos:fail]")) {
      throw new ClassifierError("Fake classifier timeout ([bos:fail]).");
    }
    if (prefix) {
      const lane = PREFIXES[prefix];
      return this.classificationFor(lane, haystack, forcedLow);
    }

    // Rule 2: complaint words win over every other lane.
    if (COMPLAINT_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("complaint", haystack, forcedLow);
    }

    // Rule 3: reply to a stored outbound quote message.
    if (input.repliedToOutboundQuote) {
      return this.classificationFor("quote_reply", haystack, forcedLow);
    }

    // Rule 4: quote words.
    if (QUOTE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("quote", haystack, forcedLow);
    }

    // Rule 5: service words.
    if (SERVICE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("service", haystack, forcedLow);
    }

    // Rule 6: FAQ words, selecting fact ids whose KB tags match.
    if (FAQ_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("faq", haystack, forcedLow);
    }

    // Rule 7: noise.
    if (NOISE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("noise", haystack, forcedLow);
    }

    // Rule 8: other at low confidence.
    return this.classificationFor("other", haystack, true);
  }

  private classificationFor(
    lane: Lane,
    haystack: string,
    low: boolean,
  ): Classification {
    const confidence = low ? "low" : "high";
    switch (lane) {
      case "complaint":
        return {
          lane,
          confidence,
          summary: "Customer complaint",
        };
      case "quote_reply": {
        const intent = haystack.includes("accept")
          ? "accept"
          : haystack.includes("decline")
            ? "decline"
            : haystack.includes("change")
              ? "change"
              : "unclear";
        return {
          lane,
          confidence,
          quoteReply: { intent },
          summary: `Quote reply (${intent})`,
        };
      }
      case "service":
        return {
          lane,
          confidence,
          service: {
            request: requestOf(haystack),
            ...SERVICE_NOTE,
          },
          summary: "Service request",
        };
      case "faq": {
        const faqFactIds = this.matchingFacts(haystack);
        return {
          lane,
          confidence,
          faqFactIds,
          summary: "Question about our service details",
        };
      }
      case "noise":
        return { lane, confidence, summary: "Automated or non-human mail" };
      case "quote":
        // Quote lines/pricing are slice 6; the artifact records the lane.
        return { lane, confidence, summary: "Quote request" };
      default:
        return { lane: "other", confidence, summary: "Unclear request" };
    }
  }

  /** Fact ids whose knowledge-block tags match the present FAQ words. */
  private matchingFacts(haystack: string): string[] {
    const present = FAQ_WORDS.filter((word) => contains(haystack, word));
    const tags = new Set(
      present.map((word) => (word === "how booking" ? "booking" : word)),
    );
    const blocks = this.knowledgeBase.getKnowledgeBase().blocks;
    const ids: string[] = [];
    for (const block of blocks) {
      if (block.tags.some((tag) => tags.has(tag))) {
        ids.push(block.id);
      }
    }
    return ids;
  }
}

/** Subject line (or first text line) as the service request note. */
function requestOf(haystack: string): string {
  const lines = haystack.split("\n").filter((line) => line.trim() !== "");
  const line = lines[0] ?? "";
  return line.trim().slice(0, 120);
}

/**
 * Keyword match: phrases match as substrings, single words on word
 * boundaries (so the service word "book" never fires on "booking").
 */
function contains(haystack: string, word: string): boolean {
  if (word.includes(" ")) {
    return haystack.includes(word);
  }
  return new RegExp(`\\b${word}\\b`).test(haystack);
}

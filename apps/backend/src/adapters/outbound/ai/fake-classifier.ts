import type { PriceRule } from "../../../core/domain/config";
import type { Lane } from "../../../core/domain/messaging";
import type {
  Classification,
  ClassifierInput,
} from "../../../core/domain/processing";
import { ClassifierError } from "../../../core/domain/processing";
import type { ClassifierPort } from "../../../core/ports/classifier";
import type { KnowledgeBaseRepository } from "../../../core/ports/knowledge-base-repository";
import type { PriceListRepository } from "../../../core/ports/price-list-repository";

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
  constructor(
    private readonly knowledgeBase: KnowledgeBaseRepository,
    private readonly priceList: PriceListRepository,
  ) {}

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
        // Slice 6: extract the customer's work items as rule ids / labels
        // (never prices — the classifier cannot see amounts, only names).
        return {
          lane,
          confidence,
          quoteRequest: { lines: this.quoteLines(haystack) },
          summary: "Quote request",
        };
      default:
        return { lane: "other", confidence, summary: "Unclear request" };
    }
  }

  /**
   * Quote-request extraction (slice 6): the longest matching rule label
   * or alias wins at each position ("oven clean" is not also a generic
   * "clean"), one line per rule. A `per_unit` rule picks up a quantity
   * from "<n> <unit>(s)" in the text when present. Names only — prices,
   * tax, and totals are computed in the domain, never here.
   */
  private quoteLines(
    haystack: string,
  ): Array<{ ruleId: string; label: string; quantity?: number }> {
    interface Candidate {
      rule: PriceRule;
      term: string;
      start: number;
      end: number;
    }
    const candidates: Candidate[] = [];
    for (const rule of this.priceList.getPriceList().rules) {
      for (const raw of [rule.label, ...(rule.aliases ?? [])]) {
        const term = raw.toLowerCase();
        const start = termIndex(haystack, term);
        if (start !== -1) {
          candidates.push({ rule, term, start, end: start + term.length });
        }
      }
    }
    candidates.sort(
      (left, right) =>
        right.term.length - left.term.length || left.start - right.start,
    );
    const lines: Array<{ ruleId: string; label: string; quantity?: number }> =
      [];
    const taken: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.rule.id)) {
        continue;
      }
      if (
        taken.some(
          ([start, end]) => candidate.start < end && start < candidate.end,
        )
      ) {
        continue;
      }
      taken.push([candidate.start, candidate.end]);
      seen.add(candidate.rule.id);
      const line: { ruleId: string; label: string; quantity?: number } = {
        ruleId: candidate.rule.id,
        label: candidate.rule.label,
      };
      if (candidate.rule.kind === "per_unit" && candidate.rule.unit) {
        const quantity = new RegExp(
          `(\\d+)[ -]*${escapeRegExp(candidate.rule.unit)}s?\b`,
        ).exec(haystack);
        if (quantity) {
          line.quantity = Number(quantity[1]);
        }
      }
      lines.push(line);
    }
    return lines;
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
  return termIndex(haystack, word) !== -1;
}

/** First position of a term: substring for phrases, word-boundary match
 * for single words (mirrors `contains`). */
function termIndex(haystack: string, word: string): number {
  if (word.includes(" ") || word.includes("-")) {
    return haystack.indexOf(word);
  }
  const match = new RegExp(`\\b${escapeRegExp(word)}\\b`).exec(haystack);
  return match ? match.index : -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

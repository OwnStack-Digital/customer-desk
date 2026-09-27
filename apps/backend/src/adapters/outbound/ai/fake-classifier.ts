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

/**
 * Fake service artifact (slice 7): internal note data only, never a
 * draft. Deterministic extraction, documented per the brief:
 * - `request` = the trimmed subject when present, else the first sentence
 *   (up to 120 characters) of the text body — the customer's ask.
 * - `supplied`/`missing` are empty arrays: the fake has no detail
 *   extraction capability, and nothing else is knowable deterministically.
 * - `nextAction` is a fixed owner action string.
 */
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
    const ask = { subject: input.email.subject, text: input.email.text };

    // Rule 1: subject prefix wins. `fail` throws; `low` forces low
    // confidence on whatever the rest of the subject would be, else other.
    const forcedLow = subject.startsWith("[bos:low]");
    const prefix = Object.keys(PREFIXES).find((tag) => subject.startsWith(tag));
    if (subject.startsWith("[bos:fail]")) {
      throw new ClassifierError("Fake classifier timeout ([bos:fail]).");
    }
    if (prefix) {
      const lane = PREFIXES[prefix];
      return this.classificationFor(lane, haystack, forcedLow, ask);
    }

    // Rule 2: complaint words win over every other lane.
    if (COMPLAINT_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("complaint", haystack, forcedLow, ask);
    }

    // Rule 3: reply to a stored outbound quote message.
    if (input.repliedToOutboundQuote) {
      return this.classificationFor("quote_reply", haystack, forcedLow, ask);
    }

    // Rule 4: quote words.
    if (QUOTE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("quote", haystack, forcedLow, ask);
    }

    // Rule 5: service words.
    if (SERVICE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("service", haystack, forcedLow, ask);
    }

    // Rule 6: FAQ words, selecting fact ids whose KB tags match.
    if (FAQ_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("faq", haystack, forcedLow, ask);
    }

    // Rule 7: noise.
    if (NOISE_WORDS.some((word) => contains(haystack, word))) {
      return this.classificationFor("noise", haystack, forcedLow, ask);
    }

    // Rule 8: other at low confidence.
    return this.classificationFor("other", haystack, true, ask);
  }

  private classificationFor(
    lane: Lane,
    haystack: string,
    low: boolean,
    ask: { subject?: string; text?: string },
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
            request: requestOf(ask),
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
          `(\\d+)[ -]*${escapeRegExp(candidate.rule.unit)}s?\\b`,
        ).exec(haystack);
        if (quantity) {
          line.quantity = Number(quantity[1]);
        }
      }
      lines.push(line);
    }
    return preferServiceLines(this.priceList.getPriceList(), haystack, lines);
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

/**
 * The service note's `request` slot (documented slice-7 extraction): the
 * trimmed subject when present, else the first sentence of the text body
 * (up to 120 characters). The customer's ask, verbatim — never invented.
 */
const BOND_WORDS = /\bbond\b|end of lease|end-of-lease|\bvacate\b/;
const RECURRING_WORDS =
  /\bweekly\b|\bfortnightly\b|\brecurring\b|\bevery week\b/;

/**
 * Room words match the occupied rule. A bond or vacate email should use
 * the bond rule for that room instead. A weekly email should use the
 * recurring rule, so the first visit is priced separately in code.
 */
function preferServiceLines(
  priceList: { readonly rules: readonly PriceRule[] },
  haystack: string,
  lines: Array<{ ruleId: string; label: string; quantity?: number }>,
): Array<{ ruleId: string; label: string; quantity?: number }> {
  const bond = BOND_WORDS.test(haystack);
  const recurring = !bond && RECURRING_WORDS.test(haystack);
  return lines.map((line) => {
    const rule = priceList.rules.find((item) => item.id === line.ruleId);
    if (!rule) {
      return line;
    }
    if (bond && rule.id.startsWith("occupied_")) {
      const bondId = `bond_${rule.id.slice("occupied_".length).replace(/_recurring$/, "")}`;
      const bondRule = priceList.rules.find((item) => item.id === bondId);
      if (bondRule) {
        return {
          ruleId: bondRule.id,
          label: bondRule.label,
          ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        };
      }
    }
    if (recurring && rule.initialRuleId === undefined) {
      const follow = priceList.rules.find(
        (item) => item.initialRuleId === rule.id,
      );
      if (follow) {
        return {
          ruleId: follow.id,
          label: follow.label,
          ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        };
      }
    }
    return line;
  });
}

function requestOf(ask: { subject?: string; text?: string }): string {
  const subject = ask.subject?.trim();
  if (subject !== undefined && subject !== "") {
    return subject.slice(0, 120);
  }
  const firstSentence = (ask.text ?? "").split(/[.!\n]/)[0] ?? "";
  const trimmed = firstSentence.trim();
  return trimmed.slice(0, 120);
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

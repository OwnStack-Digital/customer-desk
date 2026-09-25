/**
 * Domain types for draft revisions and FAQ body rendering (PLAN.md slice 4).
 * The drafter returns optional non-binding wording only; the customer-
 * visible body is rendered in code from knowledge-block texts, so a draft
 * cannot contain a factual sentence absent from the selected blocks
 * (docs/PLAN.md "Body rendering").
 */

/** Draft revision status (PLAN.md `draft_revisions` table). */
export type DraftStatus =
  | "proposed"
  | "approved"
  | "consumed"
  | "discarded"
  | "superseded";

/**
 * Who authored a draft revision (PLAN.md slice 5): `processing` for
 * machine-authored originals, `operator` for operator edits. Processing
 * supersede only ever touches `processing`/`proposed` drafts, so an
 * operator edit or an operator decision is never silently undone.
 */
export type DraftOrigin = "processing" | "operator";

/** Draft statuses the thread UI displays (PLAN.md `Thread.draft`). */
export type DisplayDraftStatus = "proposed" | "approved";

/** The drafter's entire contract: optional wrapper wording, nothing else. */
export interface DrafterWording {
  readonly greeting?: string;
  readonly closing?: string;
}

/** One persisted draft revision (PLAN.md slice 4, `draft_revisions`). */
export interface DraftRevision {
  readonly id: string;
  readonly organizationId: string;
  readonly conversationId: string;
  /** The originating inbound message. */
  readonly messageId: string;
  readonly status: DraftStatus;
  /** Author of the revision: the pipeline or an operator edit. */
  readonly origin: DraftOrigin;
  readonly bodyText: string;
  /** Fact ids in the order their blocks appear in the body. */
  readonly factIds: readonly string[];
  readonly knowledgeBaseVersion: string | null;
  /** Empty until quotes land in slice 6. */
  readonly assumptions: readonly string[];
  /** Set when the draft becomes an outbound message (slice 5); unique. */
  readonly outboundMessageId: string | null;
  /** Quote reference (slice 6). */
  readonly quoteVersionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One shared fact-id order (carried review note 11): plain code-unit
 * comparison, no locale. The renderer's body order and the stored
 * `fact_ids` order must agree in every environment, so both sites use
 * this comparator and nothing else.
 */
export function compareFactIds(
  left: string | { readonly id: string },
  right: string | { readonly id: string },
): number {
  const a = typeof left === "string" ? left : left.id;
  const b = typeof right === "string" ? right : right.id;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Currency symbols that make drafter wording unsafe (drop entirely). */
const CURRENCY_SYMBOLS = ["$", "€", "£", "¥", "₩", "₹", "₽", "¢"];

/** Promise-like words that make drafter wording unsafe (drop entirely). */
const FORBIDDEN_WORDS = ["guarantee", "booked", "paid", "fault", "sorry we"];

/**
 * Drop rule (PLAN.md "Body rendering"): wording that contains a digit, a
 * currency symbol, or any forbidden promise word is dropped entirely — the
 * body still renders without it. Case-insensitive on words.
 */
export function isDroppedWording(wording: string): boolean {
  if (/\d/.test(wording)) {
    return true;
  }
  if (CURRENCY_SYMBOLS.some((symbol) => wording.includes(symbol))) {
    return true;
  }
  const lower = wording.toLowerCase();
  return FORBIDDEN_WORDS.some((word) => lower.includes(word));
}

/** One selected knowledge block for the FAQ renderer. */
export interface FaqBlock {
  readonly id: string;
  readonly text: string;
}

export interface FaqBodyInput {
  readonly greeting?: string;
  readonly closing?: string;
  /** Selected knowledge blocks; the body renders them in fact-id order. */
  readonly blocks: readonly FaqBlock[];
  /** Asked topics with no supporting block (explicit unknown lines). */
  readonly unknownTopics: readonly string[];
}

/** The explicit unknown line naming one missing topic. */
export function unknownLine(topic: string): string {
  return `We don't have that information yet about ${topic}.`;
}

/**
 * FAQ body = greeting + selected knowledge-block texts in fact-id order +
 * an explicit unknown line per missing topic + closing (PLAN.md task 4.3).
 * Wrappers that violate the drop rule are omitted; block texts are used
 * verbatim, so every non-wrapper sentence is grounded in a block.
 */
export function buildFaqBody(input: FaqBodyInput): string {
  const greeting = clean(input.greeting);
  const closing = clean(input.closing);
  const blocks = [...input.blocks].sort(compareFactIds);
  const lines = [
    ...(greeting ? [greeting] : []),
    ...blocks.map((block) => block.text),
    ...input.unknownTopics.map((topic) => unknownLine(topic)),
    ...(closing ? [closing] : []),
  ];
  return lines.join("\n\n");
}

function clean(wording: string | undefined): string | undefined {
  if (wording === undefined) {
    return undefined;
  }
  const trimmed = wording.trim();
  return trimmed === "" || isDroppedWording(trimmed) ? undefined : trimmed;
}

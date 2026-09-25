/**
 * Domain types for message processing (PLAN.md slice 3). The classifier
 * returns classification slots only — never prices, tax, or permission to
 * send (docs/ARCHITECTURE.md "Classifier and drafter ports").
 */

import type { Lane, ProcessingStatus } from "./messaging";

export type ClassificationConfidence = "high" | "low";

export type QuoteReplyIntent = "accept" | "decline" | "change" | "unclear";

/** The classifier's lane artifact. Optional slots stay undefined when the
 * lane does not produce them. */
export interface Classification {
  readonly lane: Lane;
  readonly confidence: ClassificationConfidence;
  readonly quoteRequest?: {
    readonly lines: ReadonlyArray<{
      readonly ruleId?: string;
      readonly label: string;
      readonly quantity?: number;
    }>;
  };
  readonly faqFactIds?: readonly string[];
  readonly service?: {
    readonly request: string;
    readonly supplied: readonly string[];
    readonly missing: readonly string[];
    readonly nextAction: string;
  };
  /** The `candidateQuoteVersionIds` slot is enrichment added by processing
   * (slice 7), not by the classifier: only processing can see the
   * conversation's sent quote versions at that time. */
  readonly quoteReply?: {
    readonly intent: QuoteReplyIntent;
    readonly candidateQuoteVersionIds?: readonly string[];
  };
  readonly summary: string;
}

/**
 * Timeout-style failure thrown by a classifier adapter (e.g. the fake
 * `[bos:fail]` prefix). The use case records a `failed` revision; the
 * message itself always stays stored.
 */
export class ClassifierError extends Error {
  constructor(message = "The classifier did not return in time.") {
    super(message);
    this.name = "ClassifierError";
  }
}

/**
 * One processing attempt of one stored message. Revision numbers start at 1
 * per message; retries append new revisions rather than mutating old ones.
 * The `classification` column stores the full Classification artifact.
 */
export interface ProcessingRevision {
  readonly id: string;
  readonly organizationId: string;
  readonly messageId: string;
  readonly revisionNumber: number;
  readonly status: ProcessingStatus;
  readonly lane: Lane | null;
  readonly summary: string | null;
  /** Full Classification artifact, JSON-serialized by the adapter. */
  readonly classification: Classification | null;
  /** Failure detail for `failed` revisions. */
  readonly error: string | null;
  /** Config reference: knowledge-base version used for this attempt. */
  readonly knowledgeBaseVersion: string | null;
  readonly createdAt: string;
}

/** Config reference and terminal outcome types. */
export type TerminalProcessingStatus = "ready" | "needs_human" | "failed";

/** The owner-facing outcome of one processing attempt. `processing` is
 * reported only by the retry route when an attempt is already in flight. */
export interface ProcessingResult {
  readonly revisionId: string;
  readonly status: TerminalProcessingStatus | "processing";
  readonly lane?: Lane;
  readonly summary: string;
}

/** Minimal classifier input: the email plus threading context flags. */
export interface ClassifierInput {
  readonly email: {
    readonly subject?: string;
    readonly text?: string;
    readonly inReplyTo?: string;
    readonly references?: readonly string[];
  };
  /**
   * True when `inReplyTo`/`references` hit a stored outbound quote message
   * of this mailbox (quote versions land in slice 6; until then any stored
   * outbound message counts).
   */
  readonly repliedToOutboundQuote: boolean;
}

/**
 * Domain types for conversations and stored email messages (PLAN.md slice 2).
 * Timestamps are ISO-8601 strings; ids are ULIDs. The normalized
 * `InboundEmail` DTO arrives already parsed; MIME handling is out of scope.
 */

import { ValidationError } from "./errors";
import type { OwnerVisibleQuoteStatus, QuoteDecision } from "./quote";

/** Operator and customer compose limit. Long enough for a real email. */
export const MESSAGE_TEXT_MAX_LENGTH = 8_000;

export type MessageDirection = "inbound" | "outbound";

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "needs_human"
  | "failed";

/** Classification lanes (classifier lands in slice 3). */
export type Lane =
  | "faq"
  | "quote"
  | "service"
  | "complaint"
  | "quote_reply"
  | "other"
  | "noise";

export interface EmailAttachment {
  readonly name: string;
  readonly mime: string;
  /** Positive integer byte size. */
  readonly size: number;
}

/** Connector-posted normalized email (docs/ARCHITECTURE.md). */
export interface InboundEmail {
  readonly mailboxId: string;
  /** Dedupe key within the mailbox. */
  readonly sourceMessageId: string;
  /** RFC Message-ID header, when present. */
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly references?: readonly string[];
  readonly from: { readonly address: string; readonly name?: string };
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly replyTo?: string;
  readonly subject?: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: readonly EmailAttachment[];
  readonly receivedAt: string;
  readonly sentAt?: string;
}

export interface Conversation {
  readonly id: string;
  readonly organizationId: string;
  readonly mailboxId: string;
  /** Customer identity snapshot; no contact table in v3. */
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly subject: string | null;
  readonly automationPaused: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Immutable stored message (inbound now; outbound from slice 5). */
export interface StoredMessage {
  readonly id: string;
  readonly organizationId: string;
  readonly mailboxId: string;
  readonly conversationId: string;
  readonly direction: MessageDirection;
  readonly sourceMessageId: string;
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: string[] | null;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly to: string[];
  readonly cc: string[] | null;
  readonly replyTo: string | null;
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
  readonly attachments: EmailAttachment[] | null;
  readonly receivedAt: string;
  readonly sentAt: string | null;
}

/** Owner inbox filters (PLAN.md task 3.6). */
export type InboxFilter = "all" | "needs_human" | "complaints";

/** InboxItem JSON shape (docs/PLAN.md "JSON shapes the UI needs"). */
export interface InboxItem {
  readonly conversationId: string;
  readonly from: { readonly address: string; readonly name?: string };
  readonly subject?: string;
  readonly latestAt: string;
  /** Lane of the latest processing revision, once one exists. */
  readonly lane?: Lane;
  readonly processing: ProcessingStatus;
  /** True when the latest revision's lane is `complaint`. */
  readonly urgent: boolean;
  readonly automationPaused: boolean;
  readonly preview: string;
  /** Newest non-superseded quote on this conversation, when one exists.
   * A public accept/decline does not create a message, so this is the
   * only inbox signal that the customer decided. */
  readonly quoteStatus?: OwnerVisibleQuoteStatus;
}

export interface InboxPage {
  readonly items: readonly InboxItem[];
}

/** One message in a thread response. HTML is never included. */
export interface ThreadMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly at: string;
  readonly from: string;
  readonly subject?: string;
  readonly text?: string;
}

/** Draft section of the thread response (PLAN.md task 4.5). `factIds`
 * lists the knowledge blocks the proposed FAQ body is grounded in.
 * `totalMinor`/`currency` appear only on a quote-linked draft (slice 6);
 * they come from the immutable quote snapshot, never the current price
 * list. */
export interface ThreadDraft {
  readonly revisionId: string;
  readonly status: "proposed" | "approved";
  readonly bodyText: string;
  readonly assumptions: readonly string[];
  readonly factIds?: readonly string[];
  readonly totalMinor?: number;
  readonly currency?: string;
}

/** Thread JSON shape. `processing` is the latest revision of the
 * conversation's latest message (slice 3); `draft` is the conversation's
 * newest proposed or approved draft (slice 4); `openQuote` is the
 * conversation's open quote version (slice 6); `serviceNote` is the
 * service lane's internal note (slice 7, PLAN shape); `quoteReply` is
 * the quote-reply lane's intent and candidate quote versions (slice 7,
 * brief-sanctioned small section for the owner's confirm decision). */
export interface Thread {
  readonly conversation: {
    readonly id: string;
    readonly customer: { readonly address: string; readonly name?: string };
    readonly subject?: string;
    readonly automationPaused: boolean;
  };
  readonly messages: readonly ThreadMessage[];
  readonly processing?: {
    readonly status: ProcessingStatus;
    readonly lane?: Lane;
    readonly summary: string;
  };
  readonly draft?: ThreadDraft;
  /** Internal service note (PLAN.md `serviceNote` shape, slice 7). */
  readonly serviceNote?: {
    readonly request: string;
    readonly supplied: readonly string[];
    readonly missing: readonly string[];
    readonly nextAction: string;
  };
  /** Quote-reply intent and the sent quote versions it may refer to
   * (slice 7). Empty candidates mean a human item: nothing to confirm. */
  readonly quoteReply?: {
    readonly intent: "accept" | "decline" | "change" | "unclear";
    readonly candidateQuoteVersionIds: readonly string[];
  };
  /** The conversation's newest `prepared`/`sent` quote version, if any.
   * A recorded accept/decline leaves this unset: the quote is no longer open. */
  readonly openQuote?: {
    readonly quoteVersionId: string;
    readonly status: string;
    readonly totalMinor: number;
    readonly currency: string;
  };
  /** Newest non-superseded quote. A replacement hides nothing by itself:
   * earlier accepted and declined versions stay in `quotes`. */
  readonly quote?: ThreadQuote;
  /** Owner-visible quote versions, oldest first. Includes a declined
   * quote after a newer one is prepared. Superseded versions are omitted. */
  readonly quotes: readonly ThreadQuote[];
  /** Received mail, sent mail, and actions, oldest first. */
  readonly timeline: readonly ThreadTimelineEntry[];
}

/** One row of the conversation timeline. */
export type ThreadTimelineEntry =
  | {
      readonly kind: "received" | "sent";
      readonly id: string;
      readonly at: string;
      readonly from: string;
      readonly subject?: string;
      readonly text?: string;
    }
  | {
      readonly kind: "event";
      readonly id: string;
      readonly at: string;
      readonly actor: string;
      readonly action: string;
      readonly label: string;
    };

/** Owner-visible quote on a thread. Amounts come from the immutable snapshot. */
export interface ThreadQuote {
  readonly quoteVersionId: string;
  readonly status: OwnerVisibleQuoteStatus;
  readonly totalMinor: number;
  readonly currency: string;
  readonly decision?: QuoteDecision;
  readonly decidedAt?: string;
  /** Immutable snapshot lines, so a declined quote can be revised from them. */
  readonly lines: readonly {
    readonly ruleId: string;
    readonly name: string;
    readonly quantity?: number;
    readonly amountMinor: number;
  }[];
}

/** Malformed DTO or wrong mailbox: the shared 422 "validation" failure. */
export class InboundValidationError extends Error {
  readonly code = "validation";

  constructor(message = "The inbound email payload is not valid.") {
    super(message);
    this.name = "InboundValidationError";
  }
}

/** Trimmed compose text, or a 422 when it is empty or too long. */
export function messageTextOf(value: string): string {
  const text = value.trim();
  if (text === "") {
    throw new ValidationError("A message needs some text.");
  }
  if (text.length > MESSAGE_TEXT_MAX_LENGTH) {
    throw new ValidationError(
      `A message can be at most ${MESSAGE_TEXT_MAX_LENGTH} characters.`,
    );
  }
  return text;
}

/** `Re: <subject>` for a follow-up, without stacking another Re:. */
export function replySubject(subject: string | null | undefined): string {
  const trimmed = subject?.trim();
  if (!trimmed) {
    return "Re: your message";
  }
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function mailDomain(address: string): string {
  const at = address.indexOf("@");
  return at === -1 ? "localhost" : address.slice(at + 1);
}

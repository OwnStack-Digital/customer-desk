/**
 * Domain types for conversations and stored email messages (PLAN.md slice 2).
 * Timestamps are ISO-8601 strings; ids are ULIDs. The normalized
 * `InboundEmail` DTO arrives already parsed; MIME handling is out of scope.
 */

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
  readonly references: readonly string[] | null;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly to: readonly string[];
  readonly cc: readonly string[] | null;
  readonly replyTo: string | null;
  readonly subject: string | null;
  readonly text: string | null;
  readonly html: string | null;
  readonly attachments: readonly EmailAttachment[] | null;
  readonly receivedAt: string;
  readonly sentAt: string | null;
}

/** InboxItem JSON shape (docs/PLAN.md "JSON shapes the UI needs"). */
export interface InboxItem {
  readonly conversationId: string;
  readonly from: { readonly address: string; readonly name?: string };
  readonly subject?: string;
  readonly latestAt: string;
  /** Absent until the classifier lands (slice 3). */
  readonly lane?: Lane;
  readonly processing: ProcessingStatus;
  readonly urgent: boolean;
  readonly automationPaused: boolean;
  readonly preview: string;
}

export interface InboxPage {
  readonly items: readonly InboxItem[];
}

/** Thread JSON shape (slice 2: conversation + messages only). */
export interface Thread {
  readonly conversation: {
    readonly id: string;
    readonly customer: { readonly address: string; readonly name?: string };
    readonly subject?: string;
    readonly automationPaused: boolean;
  };
  readonly messages: readonly Array<{
    readonly id: string;
    readonly direction: MessageDirection;
    readonly at: string;
    readonly from: string;
    readonly subject?: string;
    /** Plain text only; HTML is stored but never returned to the UI. */
    readonly text?: string;
  }>;
}

/** Malformed DTO or wrong mailbox: the shared 422 "validation" failure. */
export class InboundValidationError extends Error {
  readonly code = "validation";

  constructor(message = "The inbound email payload is not valid.") {
    super(message);
    this.name = "InboundValidationError";
  }
}
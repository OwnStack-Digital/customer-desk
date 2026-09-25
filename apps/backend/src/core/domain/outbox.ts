/**
 * Domain types for the outbound outbox and audit trail (PLAN.md slice 5).
 * `sent` means provider acceptance; nothing in the demonstrator marks a
 * row `sent` — that transition belongs to the pilot delivery worker.
 */

export type OutboxStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "uncertain";

/** One persisted outbox row (PLAN.md `outbox_entries` table). */
export interface OutboxEntry {
  readonly id: string;
  readonly organizationId: string;
  /** The immutable outbound message this row queues; unique per row. */
  readonly messageId: string;
  readonly conversationId: string;
  /** Customer snapshot (the outbound recipient address). */
  readonly recipient: string;
  readonly status: OutboxStatus;
  /** Positive-integer attempt count (delivery retries land in the pilot). */
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** OutboxItem JSON shape (GET /outbox, docs/PLAN.md slice 5). */
export interface OutboxItem {
  readonly messageId: string;
  readonly conversationId: string;
  readonly recipient: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
}

export interface OutboxPage {
  readonly items: readonly OutboxItem[];
}

/** Audit actor: an operator action or `system` (pipeline-initiated). */
export type AuditActor = string;

/**
 * One audit event (PLAN.md `audit_events` table). No body, credential, or
 * raw token is ever stored — only who did what to which entity, and when.
 */
export interface AuditEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly actor: AuditActor;
  /** e.g. `draft.edited`, `draft.approved`, `draft.sent`. */
  readonly action: string;
  /** e.g. `draft_revision`, `message`, `conversation`. */
  readonly entityType: string;
  readonly entityId: string;
  readonly revisionId: string | null;
  /** Request correlation id (wired in slice 9; null until then). */
  readonly correlationId: string | null;
  readonly createdAt: string;
}
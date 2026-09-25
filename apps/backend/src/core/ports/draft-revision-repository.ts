import type { DraftRevision } from "../domain/drafting";

/**
 * Draft-revision persistence for the single organization (PLAN.md slices
 * 4–5). Status changes are conditional: the caller names the expected
 * current status so an outdated revision loses the race instead of being
 * silently mutated (the 409 `stale_revision` path).
 */
export interface DraftRevisionRepository {
  /** Inserts one draft revision row. */
  insertDraft(revision: DraftRevision): Promise<void>;

  /** The stored revision with that id in this organization, if any. */
  findById(
    organizationId: string,
    revisionId: string,
  ): Promise<DraftRevision | undefined>;

  /**
   * The newest draft revision of a conversation — the one the thread UI
   * displays when its status is `proposed` or `approved`.
   */
  findLatestByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<DraftRevision | undefined>;

  /** Marks one revision `superseded` (an edit or a newer draft replaced it). */
  supersede(organizationId: string, revisionId: string): Promise<void>;

  /**
   * Draft-replacement policy (PLAN.md slice 5): processing supersede may
   * only touch machine-authored untouched originals — origin
   * `processing`, status `proposed` — of one conversation. Operator,
   * approved, discarded, and consumed drafts are never silently
   * superseded here. Returns the number of superseded rows.
   */
  supersedeProcessingProposed(
    organizationId: string,
    conversationId: string,
  ): Promise<number>;

  /**
   * Conditional status transition. Returns false when the row was not in
   * `from` (e.g. it was superseded, discarded, or already approved), which
   * the caller maps to 409 `stale_revision`.
   */
  updateStatus(
    organizationId: string,
    revisionId: string,
    from: "proposed" | "approved",
    to: "approved" | "discarded",
  ): Promise<boolean>;

  /**
   * Consumes an approved revision into an outbound message (PLAN.md
   * slice 5): conditional update `... WHERE status = 'approved'`. Returns
   * false when another send already consumed it or the draft is not
   * approved; the unique `outbound_message_id` makes the invariant
   * airtight at the database level.
   */
  consume(
    organizationId: string,
    revisionId: string,
    outboundMessageId: string,
    updatedAt: string,
  ): Promise<boolean>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const DRAFT_REVISION_REPOSITORY = "DraftRevisionRepository";
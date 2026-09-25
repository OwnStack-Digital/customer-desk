import type { DraftRevision } from "../domain/drafting";

/**
 * Draft-revision persistence for the single organization (PLAN.md slice 4).
 * Exposes only the operations this slice needs; approve/send lands in
 * slice 5.
 */
export interface DraftRevisionRepository {
  /** Inserts one draft revision row (status starts as `proposed` here). */
  insertDraft(revision: DraftRevision): Promise<void>;

  /**
   * The newest draft revision of a conversation — the one the thread UI
   * displays when its status is `proposed` or `approved`.
   */
  findLatestByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<DraftRevision | undefined>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const DRAFT_REVISION_REPOSITORY = "DraftRevisionRepository";

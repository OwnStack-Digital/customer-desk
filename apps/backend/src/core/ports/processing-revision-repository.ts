import type {
  ProcessingRevision,
  TerminalProcessingStatus,
} from "../domain/processing";

/**
 * Processing-revision persistence for the single organization (PLAN.md
 * slice 3). Exposes only the operations the processing use cases need.
 */
export interface ProcessingRevisionRepository {
  /** Appends one revision row (unique per `(messageId, revisionNumber)`). */
  insertRevision(revision: ProcessingRevision): Promise<void>;

  /** Marks an inserted `processing` revision with its terminal outcome. */
  completeRevision(
    id: string,
    result: {
      status: TerminalProcessingStatus;
      lane: ProcessingRevision["lane"];
      summary: ProcessingRevision["summary"];
      classification: ProcessingRevision["classification"];
      error: ProcessingRevision["error"];
    },
  ): Promise<void>;

  /** The revision of a message with the greatest revision number. */
  findLatestByMessage(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingRevision | undefined>;

  /**
   * One revision per message of the organization — the one with the greatest
   * revision number. Used by the inbox and thread reads.
   */
  findLatestPerMessage(organizationId: string): Promise<ProcessingRevision[]>;
}

export const PROCESSING_REVISION_REPOSITORY = "ProcessingRevisionRepository";

import type { StoredMessage } from "../domain/messaging";

/** Message persistence for the single organization (PLAN.md slice 2). */
export interface MessageRepository {
  insertMessage(message: StoredMessage): Promise<void>;

  /**
   * Dedupe lookup on `(mailboxId, sourceMessageId)`. Only inbound rows are
   * unique on that pair (partial unique index at the database level).
   */
  findBySourceKey(
    mailboxId: string,
    sourceMessageId: string,
  ): Promise<StoredMessage | undefined>;

  /** Threading lookup against stored RFC Message-IDs in one mailbox. */
  findByRfcMessageId(
    mailboxId: string,
    rfcMessageId: string,
  ): Promise<StoredMessage | undefined>;

  /** The newest message of every conversation of the organization. */
  findLatestPerConversation(organizationId: string): Promise<StoredMessage[]>;

  /** All messages of one conversation, oldest first. */
  listByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<StoredMessage[]>;
}

export const MESSAGE_REPOSITORY = "MessageRepository";
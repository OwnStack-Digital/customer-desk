import type { Conversation } from "../domain/messaging";

/** Conversation persistence for the single organization (PLAN.md slice 2). */
export interface ConversationRepository {
  insertConversation(conversation: Conversation): Promise<void>;

  findById(
    organizationId: string,
    conversationId: string,
  ): Promise<Conversation | undefined>;

  /** Every conversation of the organization (inbox listing joins this). */
  listByOrganization(organizationId: string): Promise<Conversation[]>;

  /**
   * Deletes one conversation. Used only for the orphan cleanup on the
   * duplicate-ingress race (carried review note 9): a conversation this
   * request created but that ended up with no messages.
   */
  deleteById(organizationId: string, conversationId: string): Promise<void>;
}

export const CONVERSATION_REPOSITORY = "ConversationRepository";

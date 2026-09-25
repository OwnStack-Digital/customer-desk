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
}

export const CONVERSATION_REPOSITORY = "ConversationRepository";

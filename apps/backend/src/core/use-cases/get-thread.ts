import type { Thread } from "../domain/messaging";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { MessageRepository } from "../ports/message-repository";

export interface GetThreadDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
}

/**
 * One conversation with its messages (PLAN.md task 2.4). Slice 2 returns
 * only the conversation snapshot and plain-text messages; processing,
 * drafts, and quotes arrive in later slices. HTML is never returned.
 * Unknown ids resolve to `undefined` (HTTP layer maps that to 404).
 */
export class GetThread {
  constructor(private readonly deps: GetThreadDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
  ): Promise<Thread | undefined> {
    const conversation = await this.deps.conversations.findById(
      organizationId,
      conversationId,
    );
    if (!conversation) {
      return undefined;
    }
    const messages = await this.deps.messages.listByConversation(
      organizationId,
      conversationId,
    );
    return {
      conversation: {
        id: conversation.id,
        customer: {
          address: conversation.fromAddress,
          name: conversation.fromName ?? undefined,
        },
        subject: conversation.subject ?? undefined,
        automationPaused: conversation.automationPaused,
      },
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        at: message.receivedAt,
        from: message.fromAddress,
        subject: message.subject ?? undefined,
        text: message.text ?? undefined,
      })),
    };
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const GET_THREAD = "GetThread";

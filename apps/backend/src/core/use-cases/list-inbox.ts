import type { InboxItem, InboxPage } from "../domain/messaging";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { MessageRepository } from "../ports/message-repository";

export interface ListInboxDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
}

/** Plain-text inbox preview length (slice 2: text only, never HTML). */
export const PREVIEW_MAX_LENGTH = 140;

/**
 * Lists conversations newest activity first (PLAN.md task 2.4). Until the
 * classifier lands (slice 3) every item is `processing: "pending"`, not
 * urgent, and has no lane.
 */
export class ListInbox {
  constructor(private readonly deps: ListInboxDeps) {}

  async run(organizationId: string): Promise<InboxPage> {
    const conversations =
      await this.deps.conversations.listByOrganization(organizationId);
    const latest =
      await this.deps.messages.findLatestPerConversation(organizationId);
    const latestByConversation = new Map(
      latest.map((message) => [message.conversationId, message]),
    );

    const items = conversations
      .map((conversation): InboxItem => {
        const message = latestByConversation.get(conversation.id);
        return {
          conversationId: conversation.id,
          from: {
            address: conversation.fromAddress,
            name: conversation.fromName ?? undefined,
          },
          subject: conversation.subject ?? undefined,
          latestAt: message ? message.receivedAt : conversation.createdAt,
          processing: "pending",
          urgent: false,
          automationPaused: conversation.automationPaused,
          preview: previewOf(message?.text ?? undefined),
        };
      })
      // ISO-8601 strings sort chronologically as plain text.
      .sort((left, right) => right.latestAt.localeCompare(left.latestAt));

    return { items };
  }
}

/** Short single-line plain-text preview; whitespace collapses, HTML never. */
function previewOf(text: string | undefined): string {
  if (!text) {
    return "";
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const LIST_INBOX = "ListInbox";

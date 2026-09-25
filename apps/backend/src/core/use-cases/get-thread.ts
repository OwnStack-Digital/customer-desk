import type { Thread } from "../domain/messaging";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { DraftRevisionRepository } from "../ports/draft-revision-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";

export interface GetThreadDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly drafts: DraftRevisionRepository;
}

/**
 * One conversation with its messages (PLAN.md task 3.6). `processing` is the
 * latest revision of the conversation's latest message; `summary` is always
 * present once a revision completed. HTML is never returned. Unknown ids
 * resolve to `undefined` (HTTP layer maps that to 404).
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
    const latestMessage = messages[messages.length - 1];
    const latestRevision = latestMessage
      ? await this.deps.revisions.findLatestByMessage(
          organizationId,
          latestMessage.id,
        )
      : undefined;
    // Task 4.5: the newest proposed/approved draft of the conversation,
    // with the fact ids its body is grounded in.
    const draft = await this.deps.drafts.findLatestByConversation(
      organizationId,
      conversationId,
    );
    const threadDraft =
      draft && (draft.status === "proposed" || draft.status === "approved")
        ? {
            revisionId: draft.id,
            status: draft.status,
            bodyText: draft.bodyText,
            assumptions: [...draft.assumptions],
            ...(draft.factIds.length > 0
              ? { factIds: [...draft.factIds] }
              : {}),
          }
        : undefined;
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
      processing: latestRevision
        ? {
            status: latestRevision.status,
            lane: latestRevision.lane ?? undefined,
            summary: latestRevision.summary ?? "",
          }
        : undefined,
      draft: threadDraft,
    };
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const GET_THREAD = "GetThread";

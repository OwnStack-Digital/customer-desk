import type { StoredMessage } from "../../domain/messaging";
import {
  mailDomain,
  messageTextOf,
  replySubject,
} from "../../domain/messaging";
import type { OutboxEntry } from "../../domain/outbox";
import type { Clock } from "../../ports/clock";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { IdGenerator } from "../../ports/id-generator";
import type { MessageRepository } from "../../ports/message-repository";
import type { OrganizationProfileRepository } from "../../ports/organization-profile-repository";
import type { UnitOfWork } from "../../ports/unit-of-work";

export interface SendOperatorMessageDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly profile: OrganizationProfileRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface SentOperatorMessage {
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * Operator compose (any stage): queues one outbound email on a conversation
 * without an approved draft. It does not consume a draft, issue a quote
 * token, or change quote state. Unknown conversations are `undefined`
 * (404). Empty or oversized text is a validation error.
 */
export class SendOperatorMessage {
  constructor(private readonly deps: SendOperatorMessageDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    text: string,
    actor: string,
  ): Promise<SentOperatorMessage | undefined> {
    const body = messageTextOf(text);
    const conversation = await this.deps.conversations.findById(
      organizationId,
      conversationId,
    );
    if (!conversation) {
      return undefined;
    }
    const prior = await this.deps.messages.listByConversation(
      organizationId,
      conversationId,
    );
    const profile = this.deps.profile.getProfile();
    const now = this.deps.clock.now().toISOString();
    const messageId = this.deps.ids.nextId();
    const parentId = latestRfcId(prior);
    const message: StoredMessage = {
      id: messageId,
      organizationId,
      mailboxId: profile.mailboxId,
      conversationId,
      direction: "outbound",
      sourceMessageId: `operator-${messageId}`,
      messageId: `<${messageId}@${mailDomain(profile.fromAddress)}>`,
      inReplyTo: parentId,
      references: parentId ? [parentId] : null,
      fromAddress: profile.fromAddress,
      fromName: profile.name,
      to: [conversation.fromAddress],
      cc: null,
      replyTo: null,
      subject: replySubject(conversation.subject),
      text: body,
      html: null,
      attachments: null,
      receivedAt: now,
      sentAt: null,
    };
    const outbox: OutboxEntry = {
      id: this.deps.ids.nextId(),
      organizationId,
      messageId,
      conversationId,
      recipient: conversation.fromAddress,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.unitOfWork.run(async (repos) => {
      await repos.messages.insertMessage(message);
      await repos.outbox.insertOutbox(outbox);
      await repos.audit.insertEvent({
        id: this.deps.ids.nextId(),
        organizationId,
        actor,
        action: "message.sent",
        entityType: "message",
        entityId: messageId,
        revisionId: null,
        correlationId: null,
        createdAt: now,
      });
    });
    return { messageId, conversationId };
  }
}

function latestRfcId(messages: readonly StoredMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rfcId = messages[index]?.messageId;
    if (rfcId) {
      return rfcId;
    }
  }
  return null;
}

export const SEND_OPERATOR_MESSAGE = "SendOperatorMessage";

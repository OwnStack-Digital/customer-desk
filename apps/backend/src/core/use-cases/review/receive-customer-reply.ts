import type { StoredMessage } from "../../domain/messaging";
import {
  mailDomain,
  messageTextOf,
  replySubject,
} from "../../domain/messaging";
import type { Clock } from "../../ports/clock";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { IdGenerator } from "../../ports/id-generator";
import type { MessageRepository } from "../../ports/message-repository";
import type { OrganizationProfileRepository } from "../../ports/organization-profile-repository";
import type { UnitOfWork } from "../../ports/unit-of-work";
import type { ProcessInboundMessage } from "../ingress/process-inbound-message";

export interface ReceiveCustomerReplyDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly profile: OrganizationProfileRepository;
  readonly unitOfWork: UnitOfWork;
  readonly processing: ProcessInboundMessage;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface ReceivedCustomerReply {
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * Operator-driven customer compose. The message is stored as inbound from
 * the conversation's customer, then processed, so the thread shows the
 * reply and whatever draft or note it produced. It does not send mail and
 * does not decide a quote. Unknown conversations are `undefined` (404).
 */
export class ReceiveCustomerReply {
  constructor(private readonly deps: ReceiveCustomerReplyDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    text: string,
    actor: string,
  ): Promise<ReceivedCustomerReply | undefined> {
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
      direction: "inbound",
      sourceMessageId: `customer-${messageId}`,
      messageId: `<${messageId}@${mailDomain(conversation.fromAddress)}>`,
      inReplyTo: parentId,
      references: parentId ? [parentId] : null,
      fromAddress: conversation.fromAddress,
      fromName: conversation.fromName,
      to: [profile.fromAddress],
      cc: null,
      replyTo: null,
      subject: replySubject(conversation.subject),
      text: body,
      html: null,
      attachments: null,
      receivedAt: now,
      sentAt: null,
    };
    await this.deps.unitOfWork.run(async (repos) => {
      await repos.messages.insertMessage(message);
      await repos.audit.insertEvent({
        id: this.deps.ids.nextId(),
        organizationId,
        actor,
        action: "message.received",
        entityType: "message",
        entityId: messageId,
        revisionId: null,
        correlationId: null,
        createdAt: now,
      });
    });
    try {
      await this.deps.processing.run(organizationId, messageId);
    } catch {
      // Stored already. Processing records its own failure when it can.
    }
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

export const RECEIVE_CUSTOMER_REPLY = "ReceiveCustomerReply";

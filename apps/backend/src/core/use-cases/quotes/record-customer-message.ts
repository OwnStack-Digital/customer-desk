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
import type { QuoteVersionRepository } from "../../ports/quote-version-repository";
import type { TokenHasher } from "../../ports/token-hasher";
import type { UnitOfWork } from "../../ports/unit-of-work";
import type { ProcessInboundMessage } from "../ingress/process-inbound-message";
import { findVisibleQuote } from "./record-quote-decision";

export interface RecordCustomerMessageDeps {
  readonly quotes: QuoteVersionRepository;
  readonly tokenHasher: TokenHasher;
  readonly profile: OrganizationProfileRepository;
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly unitOfWork: UnitOfWork;
  readonly processing: ProcessInboundMessage;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface RecordedCustomerMessage {
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * Customer compose on a still-visible quote link (sent, accepted, or
 * declined). The token is the credential; it is hashed for lookup and
 * never stored or logged. Expired, superseded, and unknown tokens are
 * `undefined` (404). The message is committed before processing, so a
 * classifier failure cannot drop the customer's text.
 */
export class RecordCustomerMessage {
  constructor(private readonly deps: RecordCustomerMessageDeps) {}

  async run(
    organizationId: string,
    rawToken: string,
    text: string,
  ): Promise<RecordedCustomerMessage | undefined> {
    const body = messageTextOf(text);
    const quote = await findVisibleQuote(
      this.deps,
      organizationId,
      this.deps.tokenHasher.hash(rawToken),
    );
    if (!quote) {
      return undefined;
    }
    const conversation = await this.deps.conversations.findById(
      organizationId,
      quote.conversationId,
    );
    if (!conversation) {
      return undefined;
    }
    const prior = await this.deps.messages.listByConversation(
      organizationId,
      conversation.id,
    );
    const profile = this.deps.profile.getProfile();
    const now = this.deps.clock.now().toISOString();
    const messageId = this.deps.ids.nextId();
    const parentId = latestRfcId(prior);
    const message: StoredMessage = {
      id: messageId,
      organizationId,
      mailboxId: profile.mailboxId,
      conversationId: conversation.id,
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
        actor: "customer",
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
      // The message is already stored. Processing records its own failure
      // when it can; an unexpected throw must not look like a lost message.
    }
    return { messageId, conversationId: conversation.id };
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

export const RECORD_CUSTOMER_MESSAGE = "RecordCustomerMessage";

import type { StoredMessage } from "../../domain/messaging";
import { messageTextOf } from "../../domain/messaging";
import type { Clock } from "../../ports/clock";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { IdGenerator } from "../../ports/id-generator";
import type { MessageRepository } from "../../ports/message-repository";
import type { OrganizationProfileRepository } from "../../ports/organization-profile-repository";
import type { UnitOfWork } from "../../ports/unit-of-work";
import type { ProcessInboundMessage } from "../ingress/process-inbound-message";

export interface InstructAssistantDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly profile: OrganizationProfileRepository;
  readonly unitOfWork: UnitOfWork;
  readonly processing: ProcessInboundMessage;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface AssistantInstruction {
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * Owner → assistant. Stores an internal instruction and processes it, so a
 * later turn can replace the draft. It does not queue email, consume a
 * draft, or change quote state. Unknown conversations are `undefined`.
 */
export class InstructAssistant {
  constructor(private readonly deps: InstructAssistantDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    text: string,
    actor: string,
  ): Promise<AssistantInstruction | undefined> {
    const body = messageTextOf(text);
    const conversation = await this.deps.conversations.findById(
      organizationId,
      conversationId,
    );
    if (!conversation) {
      return undefined;
    }
    const profile = this.deps.profile.getProfile();
    const now = this.deps.clock.now().toISOString();
    const messageId = this.deps.ids.nextId();
    const message: StoredMessage = {
      id: messageId,
      organizationId,
      mailboxId: profile.mailboxId,
      conversationId,
      direction: "instruction",
      sourceMessageId: `instruction-${messageId}`,
      messageId: null,
      inReplyTo: null,
      references: null,
      fromAddress: actor,
      fromName: "Owner",
      to: [],
      cc: null,
      replyTo: null,
      subject: null,
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
        action: "assistant.instructed",
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

export const INSTRUCT_ASSISTANT = "InstructAssistant";

import type {
  Conversation,
  InboundEmail,
  ProcessingStatus,
  StoredMessage,
} from "../domain/messaging";
import { InboundValidationError } from "../domain/messaging";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";
import type { ProcessInboundMessage } from "./process-inbound-message";

export interface ReceiveInboundEmailDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly profile: OrganizationProfileRepository;
  readonly processing: ProcessInboundMessage;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface ReceiveInboundEmailResult {
  readonly messageId: string;
  readonly conversationId: string;
  readonly duplicate: boolean;
  /** No classifier in slice 2; the seam for post-commit processing is here. */
  readonly processing: ProcessingStatus;
}

/**
 * Stores one normalized inbound email (PLAN.md task 2.2): validate the DTO
 * invariants, dedupe on `(mailboxId, sourceMessageId)`, thread by
 * `inReplyTo` / `references` against stored RFC Message-IDs in the same
 * mailbox, or create a new conversation. Subject and sender are never
 * threading signals. The message is committed by the repository insert
 * before processing starts (task 3.4): the post-commit
 * `ProcessInboundMessage` call records the durable outcome, and its failure
 * never rolls the receipt back.
 */
export class ReceiveInboundEmail {
  constructor(private readonly deps: ReceiveInboundEmailDeps) {}

  async run(email: InboundEmail): Promise<ReceiveInboundEmailResult> {
    validateInboundEmail(email, this.deps.profile.getProfile().mailboxId);

    const existing = await this.deps.messages.findBySourceKey(
      email.mailboxId,
      email.sourceMessageId,
    );
    if (existing) {
      // Receipt already happened; a replay never restarts processing.
      return {
        messageId: existing.id,
        conversationId: existing.conversationId,
        duplicate: true,
        processing: await this.currentStatus(
          existing.organizationId,
          existing.id,
        ),
      };
    }

    const profile = this.deps.profile.getProfile();
    // Note 9: track the conversation this request creates so the
    // duplicate-race loser can delete its orphan row.
    let conversationId = await this.resolveConversation(email);
    let createdConversationId: string | undefined;
    if (conversationId === undefined) {
      conversationId = await this.createConversation(
        email,
        profile.id,
        profile.mailboxId,
      );
      createdConversationId = conversationId;
    }

    // Note 7: normalize to canonical UTC ISO so string ordering (inbox,
    // threads) is chronological regardless of the connector's offset.
    const receivedAt = new Date(email.receivedAt).toISOString();
    const sentAt = email.sentAt ? new Date(email.sentAt).toISOString() : null;
    const message: StoredMessage = {
      id: this.deps.ids.nextId(),
      organizationId: profile.id,
      mailboxId: email.mailboxId,
      conversationId,
      direction: "inbound",
      sourceMessageId: email.sourceMessageId,
      messageId: email.messageId ?? null,
      inReplyTo: email.inReplyTo ?? null,
      references: email.references ? [...email.references] : null,
      fromAddress: email.from.address,
      fromName: email.from.name ?? null,
      to: [...email.to],
      cc: email.cc ? [...email.cc] : null,
      replyTo: email.replyTo ?? null,
      subject: email.subject ?? null,
      text: email.text ?? null,
      html: email.html ?? null,
      attachments: email.attachments ? [...email.attachments] : null,
      receivedAt,
      sentAt,
    };
    try {
      await this.deps.messages.insertMessage(message);
    } catch (error) {
      // Note 6: a concurrent duplicate loses the check-then-insert race and
      // hits the unique index. Re-run the dedupe lookup: a hit means the
      // receipt already happened (200 duplicate), anything else rethrows.
      const winner = await this.deps.messages.findBySourceKey(
        email.mailboxId,
        email.sourceMessageId,
      );
      if (winner) {
        // Note 9: this request created a conversation that never received
        // its message (the insert lost the race). Delete the orphan so the
        // inbox is not polluted by an empty `pending` conversation.
        if (createdConversationId) {
          const remaining = await this.deps.messages.listByConversation(
            profile.id,
            createdConversationId,
          );
          if (remaining.length === 0) {
            await this.deps.conversations.deleteById(
              profile.id,
              createdConversationId,
            );
          }
        }
        return {
          messageId: winner.id,
          conversationId: winner.conversationId,
          duplicate: true,
          processing: await this.currentStatus(
            winner.organizationId,
            winner.id,
          ),
        };
      }
      throw error;
    }

    // Receipt is durable. Processing runs after the commit; its failure
    // is recorded as a `failed` revision and never rolls receipt back.
    const result = await this.deps.processing.run(profile.id, message.id);
    return {
      messageId: message.id,
      conversationId,
      duplicate: false,
      processing: result.status,
    };
  }

  /** Latest revision status of an already-stored message (`pending` if none). */
  private async currentStatus(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingStatus> {
    const latest = await this.deps.revisions.findLatestByMessage(
      organizationId,
      messageId,
    );
    return latest?.status ?? "pending";
  }

  /** Threads against a stored RFC Message-ID in the same mailbox, or null. */
  private async resolveConversation(
    email: InboundEmail,
  ): Promise<string | undefined> {
    // `inReplyTo` is the immediate parent; then walk `references` from the
    // end (most recent ancestor first). Any single match threads.
    const candidates = email.inReplyTo
      ? [email.inReplyTo, ...[...(email.references ?? [])].reverse()]
      : [...(email.references ?? [])].reverse();
    for (const rfcId of candidates) {
      const match = await this.deps.messages.findByRfcMessageId(
        email.mailboxId,
        rfcId,
      );
      if (match) {
        return match.conversationId;
      }
    }
    return undefined;
  }

  private async createConversation(
    email: InboundEmail,
    organizationId: string,
    mailboxId: string,
  ): Promise<string> {
    const now = this.deps.clock.now().toISOString();
    const conversation: Conversation = {
      id: this.deps.ids.nextId(),
      organizationId,
      mailboxId,
      fromAddress: email.from.address,
      fromName: email.from.name ?? null,
      subject: email.subject ?? null,
      automationPaused: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.conversations.insertConversation(conversation);
    return conversation.id;
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const RECEIVE_INBOUND_EMAIL = "ReceiveInboundEmail";

/**
 * Plain-structure validation of the DTO invariants. The HTTP adapter has a
 * stricter schema (zod); this guards the core contract independently.
 * `mailboxId` must equal the configured mailbox id (422, never 401/404).
 */
export function validateInboundEmail(
  email: InboundEmail,
  configuredMailboxId: string,
): void {
  if (email.mailboxId !== configuredMailboxId) {
    throw new InboundValidationError(
      `mailboxId "${email.mailboxId}" does not match the configured mailbox "${configuredMailboxId}"`,
    );
  }
  if (!nonEmpty(email.sourceMessageId)) {
    throw new InboundValidationError("sourceMessageId is required");
  }
  if (!isRecord(email.from) || !nonEmpty(email.from.address)) {
    throw new InboundValidationError("from.address is required");
  }
  if (email.from.name !== undefined && typeof email.from.name !== "string") {
    throw new InboundValidationError("from.name must be a string");
  }
  // Note 8: the optional free-text fields must be strings when present.
  const freeText: Array<[string, unknown]> = [
    ["subject", email.subject],
    ["text", email.text],
    ["html", email.html],
    ["replyTo", email.replyTo],
    ["messageId", email.messageId],
    ["inReplyTo", email.inReplyTo],
  ];
  for (const [field, value] of freeText) {
    if (value !== undefined && typeof value !== "string") {
      throw new InboundValidationError(`${field} must be a string`);
    }
  }
  if (!Array.isArray(email.to) || email.to.some((item) => !nonEmpty(item))) {
    throw new InboundValidationError("to must be a list of addresses");
  }
  if (
    email.cc !== undefined &&
    (!Array.isArray(email.cc) || email.cc.some((item) => !nonEmpty(item)))
  ) {
    throw new InboundValidationError("cc must be a list of addresses");
  }
  if (
    email.references !== undefined &&
    (!Array.isArray(email.references) ||
      email.references.some((item) => !nonEmpty(item)))
  ) {
    throw new InboundValidationError("references must be a list of ids");
  }
  if (
    email.attachments !== undefined &&
    (!Array.isArray(email.attachments) ||
      email.attachments.some(
        (item) =>
          !isRecord(item) ||
          !nonEmpty(item.name) ||
          !nonEmpty(item.mime) ||
          !Number.isInteger(item.size),
      ))
  ) {
    throw new InboundValidationError(
      "attachments must be a list of { name, mime, size }",
    );
  }
  const receivedAt = Date.parse(email.receivedAt);
  if (!nonEmpty(email.receivedAt) || Number.isNaN(receivedAt)) {
    throw new InboundValidationError("receivedAt must be an ISO-8601 date");
  }
  if (email.sentAt !== undefined && Number.isNaN(Date.parse(email.sentAt))) {
    throw new InboundValidationError("sentAt must be an ISO-8601 date");
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

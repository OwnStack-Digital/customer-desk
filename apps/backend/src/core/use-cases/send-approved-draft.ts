import type { DraftRevision } from "../domain/drafting";
import { ConflictError } from "../domain/errors";
import type { AuditEvent, OutboxEntry } from "../domain/outbox";
import type { StoredMessage } from "../domain/messaging";
import type { AuditEventRepository } from "../ports/audit-event-repository";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { DraftRevisionRepository } from "../ports/draft-revision-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { OutboxRepository } from "../ports/outbox-repository";
import type { UnitOfWork } from "../ports/unit-of-work";

export interface SendApprovedDraftDeps {
  readonly conversations: ConversationRepository;
  /** Pre-transaction reads only; the consume itself runs in the unit of work. */
  readonly drafts: DraftRevisionRepository;
  readonly profile: OrganizationProfileRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Send response: the outbound message the (already) consumed draft produced. */
export interface SendResult {
  readonly messageId: string;
  readonly conversationId: string;
  readonly revisionId: string;
}

/**
 * Internal signal: the conditional consume lost the race to a concurrent
 * send of the same approved revision. The whole transaction rolled back
 * (its message/outbox/audit inserts are gone) and the caller must return
 * the winner's existing outbound message — the idempotent 200.
 */
class AlreadyConsumedError extends Error {
  constructor(readonly outboundMessageId: string) {
    super("The approved revision was already sent.");
    this.name = "AlreadyConsumedError";
  }
}

/**
 * Sends an approved draft revision in one unit of work (PLAN.md task 5.3):
 * inside a single transaction it creates the immutable outbound `Message`,
 * a `queued` outbox row, a `draft.sent` audit event, and consumes the draft
 * with the conditional update `... WHERE status = 'approved'`.
 *
 * Exactly one outbound message may reference an approved revision. The
 * same approved revision sent twice (sequential or concurrent) returns
 * the **same** outbound message: a replay sees the consumed draft and
 * returns the stored message; a concurrent loser's conditional consume
 * updates 0 rows, its whole transaction rolls back, and it returns the
 * winner's message. Sending anything but an `approved`, not-yet-consumed
 * revision is 409 `conflict`; an unknown revision is 404 (the caller maps
 * `undefined`). Nothing marks an outbox row `sent` here — delivery is the
 * pilot worker's job.
 */
export class SendApprovedDraft {
  constructor(private readonly deps: SendApprovedDraftDeps) {}

  async run(
    organizationId: string,
    revisionId: string,
    actor: string,
  ): Promise<SendResult | undefined> {
    const draft = await this.deps.drafts.findById(organizationId, revisionId);
    if (!draft) {
      return undefined;
    }
    if (draft.outboundMessageId !== null) {
      // Idempotent replay: the draft was consumed; return its message.
      return {
        messageId: draft.outboundMessageId,
        conversationId: draft.conversationId,
        revisionId: draft.id,
      };
    }
    if (draft.status !== "approved") {
      throw new ConflictError(
        `Only an approved draft can be sent; revision ${draft.id} is ${draft.status}.`,
      );
    }
    const conversation = await this.deps.conversations.findById(
      organizationId,
      draft.conversationId,
    );
    if (!conversation) {
      throw new ConflictError(
        "The conversation this draft belongs to no longer exists.",
      );
    }

    try {
      return await this.deps.unitOfWork.run((repos) =>
        this.send(organizationId, draft, conversation.fromAddress, conversation.subject, actor, repos),
      );
    } catch (error) {
      if (error instanceof AlreadyConsumedError) {
        return {
          messageId: error.outboundMessageId,
          conversationId: draft.conversationId,
          revisionId: draft.id,
        };
      }
      throw error;
    }
  }

  /** Everything inside one transaction: message + outbox + audit + consume. */
  private async send(
    organizationId: string,
    draft: DraftRevision,
    recipient: string,
    conversationSubject: string | null,
    actor: string,
    repos: {
      messages: MessageRepository;
      drafts: DraftRevisionRepository;
      outbox: OutboxRepository;
      audit: AuditEventRepository;
    },
  ): Promise<SendResult> {
    const fresh = await repos.drafts.findById(organizationId, draft.id);
    if (!fresh) {
      throw new ConflictError("The draft revision disappeared.");
    }
    if (fresh.outboundMessageId !== null) {
      // A concurrent send won the race inside this transaction's view.
      throw new AlreadyConsumedError(fresh.outboundMessageId);
    }
    if (fresh.status !== "approved") {
      throw new ConflictError(
        `Only an approved draft can be sent; revision ${draft.id} is ${fresh.status}.`,
      );
    }

    const now = this.deps.clock.now().toISOString();
    const from = this.deps.profile.getProfile();
    const message: StoredMessage = {
      id: this.deps.ids.nextId(),
      organizationId,
      mailboxId: from.mailboxId,
      conversationId: draft.conversationId,
      direction: "outbound",
      // Outbound rows are not deduped on the source pair (partial index).
      sourceMessageId: `outbound-${draft.id}`,
      // RFC Message-ID so a customer reply can thread back onto this
      // conversation (receive threads on stored RFC ids in the mailbox).
      messageId: `<${draft.id}@${domainOf(from.fromAddress)}>`,
      inReplyTo: null,
      references: null,
      fromAddress: from.fromAddress,
      fromName: from.name,
      to: [recipient],
      cc: null,
      replyTo: null,
      subject: replySubject(conversationSubject),
      text: draft.bodyText,
      html: null,
      attachments: null,
      receivedAt: now,
      sentAt: null,
    };
    await repos.messages.insertMessage(message);

    const outbox: OutboxEntry = {
      id: this.deps.ids.nextId(),
      organizationId,
      messageId: message.id,
      conversationId: draft.conversationId,
      recipient,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await repos.outbox.insertOutbox(outbox);

    await repos.audit.insertEvent({
      id: this.deps.ids.nextId(),
      organizationId,
      actor,
      action: "draft.sent",
      entityType: "message",
      entityId: message.id,
      revisionId: draft.id,
      correlationId: null,
      createdAt: now,
    });

    const consumed = await repos.drafts.consume(
      organizationId,
      draft.id,
      message.id,
      now,
    );
    if (!consumed) {
      const reread = await repos.drafts.findById(organizationId, draft.id);
      if (reread !== undefined && reread.outboundMessageId !== null) {
        // The conditional consume lost the race: roll everything back.
        throw new AlreadyConsumedError(reread.outboundMessageId);
      }
      throw new ConflictError(
        `Only an approved draft can be sent; revision ${draft.id} is no longer approved.`,
      );
    }
    return {
      messageId: message.id,
      conversationId: draft.conversationId,
      revisionId: draft.id,
    };
  }
}

function domainOf(fromAddress: string): string {
  const at = fromAddress.indexOf("@");
  return at === -1 ? "localhost" : fromAddress.slice(at + 1);
}

/** `Re: <subject>` for the outbound copy, or a sensible minimal fallback. */
function replySubject(subject: string | null): string {
  const trimmed = subject?.trim();
  if (trimmed === undefined || trimmed === "") {
    return "Re: your message";
  }
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const SEND_APPROVED_DRAFT = "SendApprovedDraft";
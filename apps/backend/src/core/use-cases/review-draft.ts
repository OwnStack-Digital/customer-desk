import type { DraftRevision, DraftStatus } from "../domain/drafting";
import { StaleRevisionError } from "../domain/errors";
import type { AuditEvent } from "../domain/outbox";
import type { AuditEventRepository } from "../ports/audit-event-repository";
import type { Clock } from "../ports/clock";
import type { DraftRevisionRepository } from "../ports/draft-revision-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { QuoteVersionRepository } from "../ports/quote-version-repository";

export interface ReviewDraftDeps {
  readonly drafts: DraftRevisionRepository;
  readonly quotes: QuoteVersionRepository;
  readonly audit: AuditEventRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export type ReviewDraftAction =
  | { readonly action: "edit"; readonly bodyText: string }
  | { readonly action: "approve" }
  | { readonly action: "discard" };

/** Result: the draft revision the action left in place. */
export interface ReviewedDraft {
  readonly revisionId: string;
  readonly status: DraftStatus;
  readonly bodyText: string;
}

/**
 * Operator review of one draft revision (PLAN.md task 5.2), the draft
 * state machine from docs/ARCHITECTURE.md:
 *
 * `proposed → approved → consumed` / `proposed|approved → discarded` /
 * `edit → superseded + new proposed revision`.
 *
 * - `edit` creates a new `proposed` revision (origin `operator`) and
 *   supersedes the old one, so any approval is cleared (edited approved
 *   draft → old `superseded`, new one unapproved). Editing a superseded,
 *   discarded, or consumed revision is 409 `stale_revision`.
 * - `approve` binds exactly that revision via a conditional
 *   `proposed → approved` update. Anything not the latest live `proposed`
 *   revision loses the race and gets 409 `stale_revision`.
 * - `discard` is terminal via a conditional `proposed|approved → discarded`
 *   update. Discarding an already-discarded (or consumed/superseded)
 *   revision is also 409 — kept deliberately simple: the terminal state
 *   is visible, the operator discards the current revision instead.
 */
export class ReviewDraft {
  constructor(private readonly deps: ReviewDraftDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    revisionId: string,
    action: ReviewDraftAction,
    actor: string,
  ): Promise<ReviewedDraft | undefined> {
    const revision = await this.deps.drafts.findById(
      organizationId,
      revisionId,
    );
    if (!revision || revision.conversationId !== conversationId) {
      // Unknown id, or a revision that belongs to another conversation.
      return undefined;
    }

    if (action.action === "edit") {
      return this.edit(organizationId, revision, action.bodyText, actor);
    }
    if (action.action === "approve") {
      return this.approve(organizationId, revision, actor);
    }
    return this.discard(organizationId, revision, actor);
  }

  /** `edit → superseded + new proposed revision`; approval is cleared. */
  private async edit(
    organizationId: string,
    revision: DraftRevision,
    bodyText: string,
    actor: string,
  ): Promise<ReviewedDraft> {
    if (revision.status !== "proposed" && revision.status !== "approved") {
      throw new StaleRevisionError(
        `The draft revision ${revision.id} was already ${revision.status}.`,
      );
    }
    const now = this.deps.clock.now().toISOString();
    const created: DraftRevision = {
      id: this.deps.ids.nextId(),
      organizationId,
      conversationId: revision.conversationId,
      // The reply still answers the same customer message.
      messageId: revision.messageId,
      status: "proposed",
      origin: "operator",
      bodyText,
      // Operator text is operator-authored: it is not grounded in the
      // knowledge blocks, so it cites no fact ids.
      factIds: [],
      knowledgeBaseVersion: null,
      assumptions: [],
      outboundMessageId: null,
      quoteVersionId: revision.quoteVersionId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.drafts.insertDraft(created);
    await this.deps.drafts.supersede(organizationId, revision.id);
    await this.deps.audit.insertEvent(
      this.event(organizationId, actor, "draft.edited", {
        entityType: "draft_revision",
        entityId: revision.id,
        revisionId: created.id,
        createdAt: now,
      }),
    );
    return {
      revisionId: created.id,
      status: created.status,
      bodyText: created.bodyText,
    };
  }

  /** Binds exactly this revision: conditional `proposed → approved`. */
  private async approve(
    organizationId: string,
    revision: DraftRevision,
    actor: string,
  ): Promise<ReviewedDraft> {
    const approved = await this.deps.drafts.updateStatus(
      organizationId,
      revision.id,
      "proposed",
      "approved",
    );
    if (!approved) {
      throw new StaleRevisionError(
        `The draft revision ${revision.id} is no longer the live proposed revision.`,
      );
    }
    const now = this.deps.clock.now().toISOString();
    await this.deps.audit.insertEvent(
      this.event(organizationId, actor, "draft.approved", {
        entityType: "draft_revision",
        entityId: revision.id,
        revisionId: revision.id,
        createdAt: now,
      }),
    );
    return {
      revisionId: revision.id,
      status: "approved",
      bodyText: revision.bodyText,
    };
  }

  /** Terminal discard: conditional `proposed|approved → discarded`. */
  private async discard(
    organizationId: string,
    revision: DraftRevision,
    actor: string,
  ): Promise<ReviewedDraft> {
    const discarded = await this.deps.drafts.updateStatus(
      organizationId,
      revision.id,
      revision.status === "approved" ? "approved" : "proposed",
      "discarded",
    );
    if (!discarded) {
      throw new StaleRevisionError(
        `The draft revision ${revision.id} was already ${revision.status === "approved" ? "handled" : revision.status}.`,
      );
    }
    const now = this.deps.clock.now().toISOString();
    if (revision.quoteVersionId !== null) {
      // An unsent quote whose draft was discarded must not stay open,
      // or a later replacement cannot be prepared.
      await this.deps.quotes.supersedePrepared(
        organizationId,
        revision.quoteVersionId,
        now,
      );
    }
    await this.deps.audit.insertEvent(
      this.event(organizationId, actor, "draft.discarded", {
        entityType: "draft_revision",
        entityId: revision.id,
        revisionId: revision.id,
        createdAt: now,
      }),
    );
    return {
      revisionId: revision.id,
      status: "discarded",
      bodyText: revision.bodyText,
    };
  }

  private event(
    organizationId: string,
    actor: string,
    action: string,
    fields: {
      entityType: string;
      entityId: string;
      revisionId: string;
      createdAt: string;
    },
  ): AuditEvent {
    return {
      id: this.deps.ids.nextId(),
      organizationId,
      actor,
      action,
      entityType: fields.entityType,
      entityId: fields.entityId,
      revisionId: fields.revisionId,
      correlationId: null,
      createdAt: fields.createdAt,
    };
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const REVIEW_DRAFT = "ReviewDraft";

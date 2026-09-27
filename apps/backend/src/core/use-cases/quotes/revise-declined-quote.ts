import type { DraftRevision } from "../../domain/drafting";
import { ConflictError, ValidationError } from "../../domain/errors";
import { buildQuote, type QuoteRequestLine } from "../../domain/pricing";
import { buildQuoteBody, quoteVersionOf } from "../../domain/quote";
import type { Clock } from "../../ports/clock";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { DraftRevisionRepository } from "../../ports/draft-revision-repository";
import type { DrafterPort } from "../../ports/drafter";
import type { IdGenerator } from "../../ports/id-generator";
import type { MessageRepository } from "../../ports/message-repository";
import type { OrganizationProfileRepository } from "../../ports/organization-profile-repository";
import type { PriceListRepository } from "../../ports/price-list-repository";
import type { QuoteVersionRepository } from "../../ports/quote-version-repository";
import type { UnitOfWork } from "../../ports/unit-of-work";

export interface ReviseDeclinedQuoteDeps {
  readonly conversations: ConversationRepository;
  readonly quotes: QuoteVersionRepository;
  readonly drafts: DraftRevisionRepository;
  readonly messages: MessageRepository;
  readonly priceList: PriceListRepository;
  readonly profile: OrganizationProfileRepository;
  readonly drafter: DrafterPort;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface PreparedQuoteRevision {
  readonly kind: "prepared";
  readonly conversationId: string;
  readonly quoteVersionId: string;
  readonly revisionId: string;
  readonly totalMinor: number;
  readonly currency: string;
}

export type ReviseDeclinedQuoteOutcome =
  | PreparedQuoteRevision
  | { readonly kind: "unknown" };

/**
 * After a customer declines, prepare a new quote from price-list inputs.
 * The declined version stays declined. The new version is `prepared` and
 * its draft is `proposed` — nothing is sent until the operator approves
 * and sends, which issues a new link. Free-form prices are rejected:
 * unpriceable lines are a validation error and create no rows.
 */
export class ReviseDeclinedQuote {
  constructor(private readonly deps: ReviseDeclinedQuoteDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    lines: readonly QuoteRequestLine[],
    actor: string,
  ): Promise<ReviseDeclinedQuoteOutcome> {
    const conversation = await this.deps.conversations.findById(
      organizationId,
      conversationId,
    );
    if (!conversation) {
      return { kind: "unknown" };
    }
    const current = await this.deps.quotes.findLatestVisibleByConversation(
      organizationId,
      conversationId,
    );
    if (current?.status !== "declined" && current?.status !== "prepared") {
      throw new ConflictError(
        "Line items can be updated only while the quote is prepared, or after it was declined.",
      );
    }
    const latestDraft = await this.deps.drafts.findLatestByConversation(
      organizationId,
      conversationId,
    );
    if (latestDraft?.status === "approved") {
      throw new ConflictError(
        "Discard or send the current draft before preparing a new quote.",
      );
    }
    if (
      current.status === "declined" &&
      latestDraft?.status === "proposed" &&
      latestDraft.origin === "operator"
    ) {
      throw new ConflictError(
        "Discard or send the current draft before preparing a new quote.",
      );
    }
    const priced = buildQuote(this.deps.priceList.getPriceList(), { lines });
    if (priced.kind === "unpriceable") {
      throw new ValidationError(priced.reasons.join(" "));
    }
    const sourceMessageId = await this.sourceMessageId(
      organizationId,
      conversationId,
      current.draftRevisionId,
    );
    const wording = await this.deps.drafter.draft();
    const now = this.deps.clock.now().toISOString();
    const quoteVersionId = this.deps.ids.nextId();
    const revisionId = this.deps.ids.nextId();
    const bodyText = buildQuoteBody({
      greeting: wording.greeting,
      closing: wording.closing,
      quote: priced,
      quoteValidityDays: this.deps.profile.getProfile().quoteValidityDays,
    });
    const draft: DraftRevision = {
      id: revisionId,
      organizationId,
      conversationId,
      messageId: sourceMessageId,
      status: "proposed",
      origin: "operator",
      bodyText,
      factIds: [],
      knowledgeBaseVersion: null,
      assumptions: [...priced.assumptions],
      outboundMessageId: null,
      quoteVersionId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.unitOfWork.run(async (repos) => {
      if (current.status === "prepared") {
        await repos.quotes.supersedePrepared(
          organizationId,
          current.id,
          now,
        );
        if (latestDraft?.status === "proposed") {
          await repos.drafts.supersede(organizationId, latestDraft.id);
        }
      }
      await repos.drafts.supersedeProcessingProposed(
        organizationId,
        conversationId,
      );
      await repos.drafts.insertDraft(draft);
      await repos.quotes.insertQuoteVersion(
        quoteVersionOf(
          {
            id: quoteVersionId,
            organizationId,
            conversationId,
            draftRevisionId: revisionId,
          },
          priced,
          now,
        ),
      );
      await repos.audit.insertEvent({
        id: this.deps.ids.nextId(),
        organizationId,
        actor,
        action: "quote.revised",
        entityType: "quote_version",
        entityId: quoteVersionId,
        revisionId,
        correlationId: null,
        createdAt: now,
      });
    });
    return {
      kind: "prepared",
      conversationId,
      quoteVersionId,
      revisionId,
      totalMinor: priced.totalMinor,
      currency: priced.currency,
    };
  }

  private async sourceMessageId(
    organizationId: string,
    conversationId: string,
    draftRevisionId: string | null,
  ): Promise<string> {
    if (draftRevisionId) {
      const draft = await this.deps.drafts.findById(
        organizationId,
        draftRevisionId,
      );
      if (draft) {
        return draft.messageId;
      }
    }
    const messages = await this.deps.messages.listByConversation(
      organizationId,
      conversationId,
    );
    const inbound = [...messages]
      .reverse()
      .find((message) => message.direction === "inbound");
    if (!inbound) {
      throw new ConflictError(
        "This conversation has no customer message to attach the new quote to.",
      );
    }
    return inbound.id;
  }
}

export const REVISE_DECLINED_QUOTE = "ReviseDeclinedQuote";

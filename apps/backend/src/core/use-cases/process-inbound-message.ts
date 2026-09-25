import type { DraftRevision } from "../domain/drafting";
import { buildFaqBody, cleanWording, compareFactIds } from "../domain/drafting";
import type { StoredMessage } from "../domain/messaging";
import { buildQuote } from "../domain/pricing";
import type {
  Classification,
  ProcessingResult,
  ProcessingRevision,
  TerminalProcessingStatus,
} from "../domain/processing";
import { buildQuoteBody, quoteVersionOf } from "../domain/quote";
import type { ClassifierPort } from "../ports/classifier";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { DraftRevisionRepository } from "../ports/draft-revision-repository";
import type { DrafterPort } from "../ports/drafter";
import type { IdGenerator } from "../ports/id-generator";
import type { KnowledgeBaseRepository } from "../ports/knowledge-base-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { PriceListRepository } from "../ports/price-list-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";
import type { QuoteVersionRepository } from "../ports/quote-version-repository";

export interface ProcessInboundMessageDeps {
  readonly messages: MessageRepository;
  readonly conversations: ConversationRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly drafts: DraftRevisionRepository;
  readonly classifier: ClassifierPort;
  readonly drafter: DrafterPort;
  readonly knowledgeBase: KnowledgeBaseRepository;
  readonly priceList: PriceListRepository;
  readonly profile: OrganizationProfileRepository;
  readonly quotes: QuoteVersionRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Explanatory summary for HTML-only / attachments-only mail (task 4.4). */
const NO_USABLE_TEXT_SUMMARY =
  "No usable text: the message is HTML-only or attachments-only. Review it manually.";

/**
 * `pending → processing → ready | needs_human | failed` for one stored
 * message (PLAN.md tasks 3.2/3.4 and 4.2–4.4). Every attempt appends a new
 * revision row that starts as `processing` and is completed with the
 * terminal outcome. The complaint-precedence and low-confidence rules live
 * in the classifier and here — never in a controller. A classifier
 * failure records `failed`; the message itself is never deleted or mutated.
 *
 * Slice 4: an FAQ lane with matched facts completes as `ready` plus one
 * `proposed` draft whose body is rendered from the selected knowledge
 * blocks (fact-id order) and stores the fact ids and knowledge-base
 * version. An FAQ with no supporting fact is `needs_human` with an explicit
 * unknown line instead — never an answer from model knowledge (the
 * drafter physically cannot add facts). HTML-only or attachments-only mail
 * is `needs_human` with no draft: there is nothing to ground on.
 *
 * Slice 6: a quote lane with a priceable request completes as `ready` plus
 * one `prepared` quote version (an immutable snapshot from `buildQuote`)
 * and one `proposed` draft linked to it, whose deterministic body carries
 * the `{{quoteLink}}` placeholder — the real link only materializes at
 * send. Unpriceable work (unknown line, missing quantity) is
 * `needs_human` with the interpretation in the summary and no draft.
 * Amounts, lines, and assumptions never change after this point.
 *
 * Slice 5 draft-replacement policy: when processing produces a new machine
 * draft for a conversation it first supersedes that conversation's origin
 * `processing`, still-`proposed` drafts (untouched machine originals).
 * Operator-authored, approved, discarded, and consumed revisions are
 * never silently superseded. While the conversation is paused (take-over),
 * processing creates and supersedes nothing — classification and
 * human/complaint items are still recorded for every inbound mail, and a
 * would-be machine draft becomes `needs_human`: the operator replies.
 */
export class ProcessInboundMessage {
  constructor(private readonly deps: ProcessInboundMessageDeps) {}

  async run(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingResult> {
    const message = await this.deps.messages.findById(
      organizationId,
      messageId,
    );
    if (!message) {
      throw new Error(`No message with id ${messageId} in this organization.`);
    }

    const latest = await this.deps.revisions.findLatestByMessage(
      organizationId,
      messageId,
    );
    const revision: ProcessingRevision = {
      id: this.deps.ids.nextId(),
      organizationId,
      messageId,
      revisionNumber: (latest?.revisionNumber ?? 0) + 1,
      status: "processing",
      lane: null,
      summary: null,
      classification: null,
      error: null,
      knowledgeBaseVersion: this.deps.knowledgeBase.getKnowledgeBase().version,
      createdAt: this.deps.clock.now().toISOString(),
    };
    try {
      await this.deps.revisions.insertRevision(revision);
    } catch (error) {
      // Note 10: a concurrent retry lost the check-then-insert race and hit
      // the `(message_id, revision_number)` unique index. Re-query and
      // return the winner's revision instead of surfacing 500.
      if (isUniqueViolation(error)) {
        const winner = await this.deps.revisions.findLatestByMessage(
          organizationId,
          messageId,
        );
        if (winner) {
          return resultOf(winner);
        }
      }
      throw error;
    }

    // Task 4.4: HTML-only or attachments-only mail needs a human, whatever
    // the lane would be. Nothing is deleted and no draft is created —
    // there is no text to ground a reply on.
    if (lacksUsableText(message)) {
      await this.deps.revisions.completeRevision(revision.id, {
        status: "needs_human",
        lane: null,
        summary: NO_USABLE_TEXT_SUMMARY,
        classification: null,
        error: null,
      });
      return {
        revisionId: revision.id,
        status: "needs_human",
        summary: NO_USABLE_TEXT_SUMMARY,
      };
    }

    try {
      const classification = await this.classify(message);
      let outcome = outcomeOf(classification);
      let summary = classification.summary;
      if (classification.lane === "faq" || classification.lane === "quote") {
        const conversation = await this.deps.conversations.findById(
          organizationId,
          message.conversationId,
        );
        if (conversation?.automationPaused) {
          // Take-over: classification is still recorded, but the current
          // draft stays exactly as it is and no machine draft is created.
          outcome = "needs_human";
        } else if (classification.lane === "faq") {
          if ((classification.faqFactIds ?? []).length === 0) {
            // Task 4.4: no supporting fact stays unknown.
            outcome = "needs_human";
          }
          // Task 4.2: the FAQ lane records one `proposed` draft revision.
          await this.insertFaqDraft(organizationId, message, classification);
        } else {
          // Slice 6: price the extracted request in code; unpriceable
          // work parks with a human — it never produces a draft.
          const priced = buildQuote(this.deps.priceList.getPriceList(), {
            lines: classification.quoteRequest?.lines ?? [],
          });
          if (priced.kind === "unpriceable") {
            outcome = "needs_human";
            summary = `Quote request cannot be priced: ${priced.reasons.join(" ")}`;
          } else {
            await this.insertQuoteDraft(organizationId, message, priced);
          }
        }
      }
      await this.deps.revisions.completeRevision(revision.id, {
        status: outcome,
        lane: classification.lane,
        summary,
        classification,
        error: null,
      });
      return {
        revisionId: revision.id,
        status: outcome,
        lane: classification.lane,
        summary,
      };
    } catch (error) {
      // Timeout-style classifier failure: durable `failed` revision, the
      // message stays stored (receipt is never rolled back).
      const detail =
        error instanceof Error ? error.message : "Unknown classifier failure";
      const summary = `Processing failed: ${detail}`;
      await this.deps.revisions.completeRevision(revision.id, {
        status: "failed",
        lane: null,
        summary,
        classification: null,
        error: detail,
      });
      return { revisionId: revision.id, status: "failed", summary };
    }
  }

  /**
   * Builds and persists the `proposed` FAQ draft (task 4.2). The body is
   * greeting + selected block texts in fact-id order (+ unknown lines) +
   * closing, with the drop rule applied to the drafter wording.
   */
  private async insertFaqDraft(
    organizationId: string,
    message: StoredMessage,
    classification: Classification,
  ): Promise<void> {
    // Draft-replacement policy (slice 5): a new machine draft supersedes
    // the conversation's untouched machine originals. Operator, approved,
    // discarded, and consumed revisions are never touched here.
    await this.deps.drafts.supersedeProcessingProposed(
      organizationId,
      message.conversationId,
    );
    const knowledgeBase = this.deps.knowledgeBase.getKnowledgeBase();
    // Fact-id order (carried note 11): one shared code-unit comparator;
    // the renderer sorts the blocks and the stored ids follow the same
    // order so the body can be replayed from the facts.
    const factIds = [...(classification.faqFactIds ?? [])].sort(compareFactIds);
    const blocks = knowledgeBase.blocks
      .filter((block) => factIds.includes(block.id))
      .map((block) => ({ id: block.id, text: block.text }));
    const unknownTopics = factIds.length === 0 ? [topicOf(message)] : [];
    const wording = await this.deps.drafter.draft();
    const bodyText = buildFaqBody({
      greeting: wording.greeting,
      closing: wording.closing,
      blocks,
      unknownTopics,
    });
    const now = this.deps.clock.now().toISOString();
    const draft: DraftRevision = {
      id: this.deps.ids.nextId(),
      organizationId,
      conversationId: message.conversationId,
      messageId: message.id,
      status: "proposed",
      origin: "processing",
      bodyText,
      factIds,
      knowledgeBaseVersion: knowledgeBase.version,
      assumptions: [],
      outboundMessageId: null,
      quoteVersionId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.drafts.insertDraft(draft);
  }

  /**
   * Builds and persists the slice-6 quote artifacts (task 6.3): one
   * `proposed` draft and one `prepared` quote version (the immutable
   * priced snapshot) linked to it. The deterministic body carries the
   * `{{quoteLink}}` placeholder (orchestrator decision: the token is
   * issued only at send). The drafter contributes only greeting/closing
   * wording, and only when it survives the drop rule. The draft is
   * inserted first (its `quote_version_id` column carries no foreign
   * key) so the snapshot row can reference it.
   */
  private async insertQuoteDraft(
    organizationId: string,
    message: StoredMessage,
    priced: Extract<ReturnType<typeof buildQuote>, { kind: "priceable" }>,
  ): Promise<void> {
    // Draft-replacement policy (slice 5), same as the FAQ lane.
    await this.deps.drafts.supersedeProcessingProposed(
      organizationId,
      message.conversationId,
    );
    const now = this.deps.clock.now().toISOString();
    const quoteVersionId = this.deps.ids.nextId();
    const wording = await this.deps.drafter.draft();
    const bodyText = buildQuoteBody({
      greeting: cleanWording(wording.greeting),
      closing: cleanWording(wording.closing),
      quote: priced,
      quoteValidityDays: this.deps.profile.getProfile().quoteValidityDays,
    });
    const draft: DraftRevision = {
      id: this.deps.ids.nextId(),
      organizationId,
      conversationId: message.conversationId,
      messageId: message.id,
      status: "proposed",
      origin: "processing",
      bodyText,
      factIds: [],
      knowledgeBaseVersion: null,
      assumptions: [...priced.assumptions],
      outboundMessageId: null,
      quoteVersionId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.drafts.insertDraft(draft);
    await this.deps.quotes.insertQuoteVersion(
      quoteVersionOf(
        {
          id: quoteVersionId,
          organizationId,
          conversationId: message.conversationId,
          draftRevisionId: draft.id,
        },
        priced,
        now,
      ),
    );
  }

  /**
   * Quote-reply context (brief 3.2): `inReplyTo` first, then `references`
   * from the end. Until quote versions exist (slice 6), any stored outbound
   * message of this mailbox counts as the replied-to quote.
   */
  private async classify(message: StoredMessage): Promise<Classification> {
    const candidates = message.inReplyTo
      ? [message.inReplyTo, ...[...(message.references ?? [])].reverse()]
      : [...(message.references ?? [])].reverse();
    let repliedToOutboundQuote = false;
    for (const rfcId of candidates) {
      const match = await this.deps.messages.findByRfcMessageId(
        message.mailboxId,
        rfcId,
      );
      if (match && match.direction === "outbound") {
        repliedToOutboundQuote = true;
        break;
      }
    }
    return this.deps.classifier.classify({
      email: {
        subject: message.subject ?? undefined,
        text: message.text ?? undefined,
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references ?? undefined,
      },
      repliedToOutboundQuote,
    });
  }
}

/**
 * Terminal status for a classification (brief 3.4): noise parks as `ready`;
 * `other`, complaints, and every low-confidence result need a human. Low
 * confidence never parks as noise.
 */
function outcomeOf(classification: Classification): TerminalProcessingStatus {
  if (classification.confidence === "low") {
    return "needs_human";
  }
  if (classification.lane === "complaint" || classification.lane === "other") {
    return "needs_human";
  }
  return "ready";
}

/** Result built from an already-stored revision (note 10 winner). */
function resultOf(revision: ProcessingRevision): ProcessingResult {
  return {
    revisionId: revision.id,
    status: revision.status === "pending" ? "processing" : revision.status,
    lane: revision.lane ?? undefined,
    summary: revision.summary ?? "Processing is already running.",
  };
}

/** Unique-index violations as raised by SQLite and Postgres. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique constraint failed|duplicate key value|violates unique/i.test(
      error.message,
    )
  );
}

/**
 * HTML-only or attachments-only mail (task 4.4): whitespace-only `text`
 * counts as no text, and HTML/attachments are metadata-only in the
 * demonstrator — there is nothing to ground a reply on.
 */
function lacksUsableText(message: StoredMessage): boolean {
  if (message.text !== null && message.text.trim() !== "") {
    return false;
  }
  return message.html !== null || message.attachments !== null;
}

/** The unknown line names the customer's question, never a made-up fact. */
function topicOf(message: StoredMessage): string {
  const subject = message.subject?.trim();
  return subject !== undefined && subject !== ""
    ? `"${subject}"`
    : "your question";
}

/** DI token (composition root only; the use case itself is framework-free). */
export const PROCESS_INBOUND_MESSAGE = "ProcessInboundMessage";

import type { StoredMessage } from "../domain/messaging";
import type {
  Classification,
  ProcessingResult,
  ProcessingRevision,
  TerminalProcessingStatus,
} from "../domain/processing";
import type { ClassifierPort } from "../ports/classifier";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { KnowledgeBaseRepository } from "../ports/knowledge-base-repository";
import type { MessageRepository } from "../ports/message-repository";
import type { ProcessingRevisionRepository } from "../ports/processing-revision-repository";

export interface ProcessInboundMessageDeps {
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly classifier: ClassifierPort;
  readonly knowledgeBase: KnowledgeBaseRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * `pending → processing → ready | needs_human | failed` for one stored
 * message (PLAN.md task 3.2/3.4). Every attempt appends a new revision row
 * that starts as `processing` and is completed with the terminal outcome.
 * The complaint-precedence and low-confidence rules live in the classifier
 * and here — never in a controller. A classifier failure records `failed`;
 * the message itself is never deleted or mutated.
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
    await this.deps.revisions.insertRevision(revision);

    try {
      const classification = await this.classify(message);
      const outcome = outcomeOf(classification);
      await this.deps.revisions.completeRevision(revision.id, {
        status: outcome,
        lane: classification.lane,
        summary: classification.summary,
        classification,
        error: null,
      });
      return {
        revisionId: revision.id,
        status: outcome,
        lane: classification.lane,
        summary: classification.summary,
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

/** DI token (composition root only; the use case itself is framework-free). */
export const PROCESS_INBOUND_MESSAGE = "ProcessInboundMessage";

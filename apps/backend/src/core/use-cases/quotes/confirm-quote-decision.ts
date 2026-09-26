import { ConflictError } from "../../domain/errors";
import type { QuoteDecision, QuoteVersion } from "../../domain/quote";
import type { Clock } from "../../ports/clock";
import type { IdGenerator } from "../../ports/id-generator";
import type { QuoteVersionRepository } from "../../ports/quote-version-repository";
import type { UnitOfWork } from "../../ports/unit-of-work";

export interface ConfirmQuoteDecisionDeps {
  readonly quotes: QuoteVersionRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Success outcome: the stored version after the confirm. */
export interface ConfirmedQuote {
  readonly kind: "confirmed";
  readonly quoteVersionId: string;
  readonly status: QuoteVersion["status"];
  readonly decision: QuoteDecision;
  readonly decidedAt: string;
}

export type ConfirmQuoteDecisionOutcome =
  | ConfirmedQuote
  /** Unknown quote version id in this organization → 404 at the edge. */
  | { readonly kind: "unknown" };

/**
 * Operator-side confirmation of a quote-reply email (PLAN.md task 7.3,
 * `POST /threads/:conversationId/quote-decision`): the owner explicitly
 * records the customer's `accept`/`decline` reply on the conversation's
 * open sent quote version, in one unit of work, with the same state
 * semantics as the public decision (`sent → accepted | declined`,
 * `decided_at`) and an audit event naming the operator email.
 *
 * Replaying the same decision is idempotent (200, no new rows); a
 * conflicting decision on an already-decided version is 409 `conflict`.
 * A version that is not the open `sent` quote of this conversation —
 * `prepared`, `superseded`, decided, or a version of another conversation —
 * is 409: the operator resolves it as a human item instead. Expiry is not
 * re-checked here: the customer's reply arrived inside the validity
 * window; the operator decision is the explicit record of it.
 */
export class ConfirmQuoteDecision {
  constructor(private readonly deps: ConfirmQuoteDecisionDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    quoteVersionId: string,
    decision: QuoteDecision,
    actor: string,
  ): Promise<ConfirmQuoteDecisionOutcome> {
    const quote = await this.deps.quotes.findById(
      organizationId,
      quoteVersionId,
    );
    if (!quote) {
      return { kind: "unknown" };
    }
    if (quote.conversationId !== conversationId) {
      throw new ConflictError(
        "The quote version is not part of this conversation.",
      );
    }
    if (quote.decidedAt !== null) {
      // Same decision replays idempotently; the opposite conflicts.
      if (quote.decision === decision) {
        return confirmedOf(quote);
      }
      throw new ConflictError(
        `This quote was already ${quote.status}; a ${decision} cannot be recorded.`,
      );
    }
    if (quote.status !== "sent") {
      throw new ConflictError(
        `The quote version ${quote.id} is not the open sent quote of this conversation (status: ${quote.status}).`,
      );
    }

    const decidedAt = this.deps.clock.now().toISOString();
    const done = await this.deps.unitOfWork.run(async (repos) => {
      const decided = await repos.quotes.decide(
        organizationId,
        quote.id,
        decision,
        decidedAt,
        decidedAt,
      );
      if (!decided) {
        return false;
      }
      await repos.audit.insertEvent({
        id: this.deps.ids.nextId(),
        organizationId,
        actor,
        // Same vocabulary as the public decision (`quote.accepted` /
        // `quote.declined`); the actor distinguishes who confirmed.
        action: decision === "accept" ? "quote.accepted" : "quote.declined",
        entityType: "quote_version",
        entityId: quote.id,
        revisionId: null,
        correlationId: null,
        createdAt: decidedAt,
      });
      return true;
    });
    if (!done) {
      // Lost a concurrent decision race: resolve the stored outcome.
      const stored = await this.deps.quotes.findById(organizationId, quote.id);
      if (stored && stored.decision === decision) {
        return confirmedOf(stored);
      }
      throw new ConflictError("This quote was already decided differently.");
    }
    const stored = await this.deps.quotes.findById(organizationId, quote.id);
    return stored ? confirmedOf(stored) : { kind: "unknown" };
  }
}

function confirmedOf(quote: QuoteVersion): ConfirmedQuote {
  return {
    kind: "confirmed",
    quoteVersionId: quote.id,
    status: quote.status,
    decision: quote.decision as QuoteDecision,
    decidedAt: quote.decidedAt as string,
  };
}

/** DI token (composition root only; the use case itself is framework-free). */
export const CONFIRM_QUOTE_DECISION = "ConfirmQuoteDecision";

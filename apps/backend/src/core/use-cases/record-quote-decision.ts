import { ConflictError } from "../domain/errors";
import type { MessageDirection, StoredMessage } from "../domain/messaging";
import type { PublicQuote, QuoteDecision, QuoteVersion } from "../domain/quote";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { IdGenerator } from "../ports/id-generator";
import type { MessageRepository } from "../ports/message-repository";
import type { OrganizationProfileRepository } from "../ports/organization-profile-repository";
import type { QuoteVersionRepository } from "../ports/quote-version-repository";
import type { TokenHasher } from "../ports/token-hasher";
import type { UnitOfWork } from "../ports/unit-of-work";

/**
 * The public token routes (PLAN.md task 6.5): display is read-only — a
 * link scanner that only GETs can never decide. An explicit POST decides,
 * exactly once: replaying the same decision is 200 idempotent, a
 * conflicting decision is 409, and an unknown/expired/superseded token is
 * 404 on **both** routes (only `sent`/`accepted`/`declined` are ever
 * displayed). Acceptance creates no payment or booking row — the quote
 * version itself is the only state that changes.
 *
 * Lookup is always by SHA-256 of the raw token; the raw token never
 * reaches a store, a log, or a response body. Message text shown to the
 * customer has the raw token redacted, because the outbound quote email
 * contains the link.
 */

export interface QuoteLookupDeps {
  readonly quotes: QuoteVersionRepository;
  readonly tokenHasher: TokenHasher;
  readonly profile: OrganizationProfileRepository;
  readonly clock: Clock;
}

/** One customer-visible message. No HTML, drafts, or internal notes. */
export interface PublicThreadMessage {
  readonly id: string;
  readonly direction: MessageDirection;
  readonly at: string;
  readonly from: string;
  readonly text?: string;
}

/** Public quote plus the conversation the customer is allowed to see. */
export interface PublicQuoteView extends PublicQuote {
  readonly messages: readonly PublicThreadMessage[];
}

export interface GetPublicQuoteDeps extends QuoteLookupDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
}

/** Public display of one quote (GET /public/quotes/:token). */
export class GetPublicQuote {
  constructor(private readonly deps: GetPublicQuoteDeps) {}

  async run(
    organizationId: string,
    rawToken: string,
  ): Promise<PublicQuoteView | undefined> {
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
    const stored = await this.deps.messages.listByConversation(
      organizationId,
      quote.conversationId,
    );
    const businessName = this.deps.profile.getProfile().name;
    return {
      ...publicQuoteOf(this.deps, quote),
      messages: stored.map((message) =>
        publicMessageOf(
          message,
          businessName,
          conversation?.fromAddress,
          rawToken,
        ),
      ),
    };
  }
}

export interface RecordQuoteDecisionDeps extends QuoteLookupDeps {
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
}

/** The explicit customer decision (POST /public/quotes/:token/decision). */
export class RecordQuoteDecision {
  constructor(private readonly deps: RecordQuoteDecisionDeps) {}

  async run(
    organizationId: string,
    rawToken: string,
    decision: QuoteDecision,
  ): Promise<PublicQuote | undefined> {
    const quote = await findVisibleQuote(
      this.deps,
      organizationId,
      this.deps.tokenHasher.hash(rawToken),
    );
    if (!quote) {
      return undefined; // unknown, expired, or superseded: 404
    }
    if (quote.decidedAt !== null) {
      // Already decided: same decision replays idempotently (200, no new
      // rows); the opposite decision conflicts (409).
      if (quote.decision === decision) {
        return publicQuoteOf(this.deps, quote);
      }
      throw new ConflictError(
        `This quote was already ${quote.status}; a ${decision} cannot be recorded.`,
      );
    }
    const decidedAt = this.deps.clock.now().toISOString();
    const done = await this.deps.unitOfWork.run(async (repos) => {
      const decided = await repos.quotes.decide(
        organizationId,
        quote.id,
        decision,
        decidedAt,
        // Carried note 17: the decision moves `updated_at` too.
        decidedAt,
      );
      if (!decided) {
        return false;
      }
      await repos.audit.insertEvent({
        id: this.deps.ids.nextId(),
        organizationId,
        // The customer acts with the token; no session, no operator.
        actor: "customer",
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
        return publicQuoteOf(this.deps, stored);
      }
      throw new ConflictError("This quote was already decided differently.");
    }
    const stored = await this.deps.quotes.findById(organizationId, quote.id);
    return stored ? publicQuoteOf(this.deps, stored) : undefined;
  }
}

/**
 * Lookup + the 404 policy: `superseded` tokens are always 404, a `sent`
 * token whose `validUntil` has passed is 404 (expired), and `accepted` /
 * `declined` are always displayable with `canDecide: false`.
 */
export async function findVisibleQuote(
  deps: QuoteLookupDeps,
  organizationId: string,
  tokenHash: string,
): Promise<QuoteVersion | undefined> {
  const quote = await deps.quotes.findByTokenHash(organizationId, tokenHash);
  if (!quote) {
    return undefined;
  }
  if (quote.status === "superseded") {
    return undefined;
  }
  if (quote.status === "sent" && !canDecide(deps, quote)) {
    // Expired: never displayed, never decidable, never messageable.
    return undefined;
  }
  return quote;
}

function canDecide(deps: QuoteLookupDeps, quote: QuoteVersion): boolean {
  return (
    quote.status === "sent" &&
    quote.validUntil !== null &&
    deps.clock.now().toISOString() <= quote.validUntil
  );
}

/** PublicQuote per docs/PLAN.md, exactly. */
function publicQuoteOf(
  deps: QuoteLookupDeps,
  quote: QuoteVersion,
): PublicQuote {
  return {
    businessName: deps.profile.getProfile().name,
    status: quote.status,
    currency: quote.currency,
    lines: quote.lines.map((line) => ({
      name: line.name,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      amountMinor: line.amountMinor,
    })),
    assumptions: [...quote.assumptions],
    subtotalMinor: quote.subtotalMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    validUntil: quote.validUntil ?? "",
    // `sent` and unexpired — decided versions are display-only.
    canDecide: canDecide(deps, quote),
  };
}

function publicMessageOf(
  message: StoredMessage,
  businessName: string,
  customerAddress: string | undefined,
  rawToken: string,
): PublicThreadMessage {
  const from =
    message.direction === "outbound"
      ? businessName
      : message.fromAddress === customerAddress
        ? "You"
        : (message.fromName ?? message.fromAddress);
  const text = message.text?.split(rawToken).join("(this link)");
  return {
    id: message.id,
    direction: message.direction,
    at: message.receivedAt,
    from,
    ...(text ? { text } : {}),
  };
}

/** DI tokens (composition root only; the use cases are framework-free). */
export const GET_PUBLIC_QUOTE = "GetPublicQuote";
export const RECORD_QUOTE_DECISION = "RecordQuoteDecision";

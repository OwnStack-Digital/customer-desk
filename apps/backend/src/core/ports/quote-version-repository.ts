import type { QuoteDecision, QuoteVersion } from "../domain/quote";

/**
 * Quote-version persistence (PLAN.md slice 6). Like the draft store,
 * state changes are conditional: the caller names the expected current
 * status so a stale version loses the race instead of being silently
 * mutated. `tokenHash` is unique: at most one live (or decided) quote
 * version can ever resolve a given token.
 */
export interface QuoteVersionRepository {
  /** Inserts one quote version row. */
  insertQuoteVersion(quote: QuoteVersion): Promise<void>;

  /** The stored version with that id in this organization, if any. */
  findById(
    organizationId: string,
    quoteVersionId: string,
  ): Promise<QuoteVersion | undefined>;

  /** Lookup by SHA-256 of the raw public token. */
  findByTokenHash(
    organizationId: string,
    tokenHash: string,
  ): Promise<QuoteVersion | undefined>;

  /**
   * The newest `prepared` or `sent` version of a conversation — the one
   * the thread UI reports as `openQuote`. Decided and superseded
   * versions are never returned here.
   */
  findLatestOpenByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<QuoteVersion | undefined>;

  /**
   * Conditional `prepared → sent`: stores the token hash, `sent_at`, and
   * `valid_until`. Returns false when the version is no longer
   * `prepared` (e.g. a concurrent send already moved it).
   */
  markSent(
    organizationId: string,
    quoteVersionId: string,
    fields: {
      readonly tokenHash: string;
      readonly sentAt: string;
      readonly validUntil: string;
      readonly updatedAt: string;
    },
  ): Promise<boolean>;

  /**
   * Supersede policy (PLAN.md task 6.4): every **other** `sent` version
   * of the conversation becomes `superseded`, revoking its token (the
   * public routes answer 404 for it). Returns the number superseded.
   */
  supersedeSentExcept(
    organizationId: string,
    conversationId: string,
    keepQuoteVersionId: string,
    updatedAt: string,
  ): Promise<number>;

  /**
   * Every `sent` quote version of a conversation — the quote-reply lane's
   * candidate set at processing time (slice 7). Superseding keeps this at
   * at most one, but the rule "no candidate or multiple candidates need a
   * human" is enforced on whatever this returns.
   */
  findSentByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<readonly QuoteVersion[]>;

  /**
   * Conditional `sent → accepted | declined`: records the decision and
   * `decided_at`. Returns false when the version was not `sent` (already
   * decided, superseded, or never sent).
   */
  decide(
    organizationId: string,
    quoteVersionId: string,
    decision: QuoteDecision,
    decidedAt: string,
    /** Carried note 17: the decision is a state change — `updated_at`
     * moves with it, same as markSent and supersedeSentExcept. */
    updatedAt: string,
  ): Promise<boolean>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const QUOTE_VERSION_REPOSITORY = "QuoteVersionRepository";

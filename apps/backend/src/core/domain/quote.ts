/**
 * Domain types for versioned quotes (PLAN.md slice 6). A quote version is
 * an immutable priced snapshot: changing the price list later never
 * changes an already computed version (acceptance rule). The raw accept
 * token exists only inside the outbound message link; the database, the
 * logs, and every API response carry only its SHA-256 hash.
 */

import type { PriceableQuote } from "./pricing";

/** `quote_versions.status` (PLAN.md table plan). */
export type QuoteVersionStatus =
  | "prepared"
  | "sent"
  | "accepted"
  | "declined"
  | "superseded";

/** Statuses the owner portal may show. A superseded token is revoked and
 * stays off the thread and the inbox. */
export type OwnerVisibleQuoteStatus = Exclude<QuoteVersionStatus, "superseded">;

/** The customer's explicit decision (public POST only). */
export type QuoteDecision = "accept" | "decline";

/** One persisted quote version (PLAN.md `quote_versions` table). */
export interface QuoteVersion {
  readonly id: string;
  readonly organizationId: string;
  readonly conversationId: string;
  /** The `proposed` draft revision this version was rendered for. */
  readonly draftRevisionId: string | null;
  readonly status: QuoteVersionStatus;
  /** SHA-256 of the raw token; null until the quote is sent. */
  readonly tokenHash: string | null;
  /** Immutable priced snapshot (never edited after creation). */
  readonly lines: readonly PricedQuoteLineSnapshot[];
  readonly assumptions: readonly string[];
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly priceListVersion: string;
  /** `sent_at + quoteValidityDays` (UTC days); null until sent. */
  readonly validUntil: string | null;
  readonly sentAt: string | null;
  readonly decidedAt: string | null;
  readonly decision: QuoteDecision | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Snapshot line as persisted in `quote_versions.lines`. */
export interface PricedQuoteLineSnapshot {
  readonly ruleId: string;
  readonly name: string;
  readonly quantity?: number;
  readonly amountMinor: number;
}

/**
 * The stable accept-link placeholder (orchestrator decision, slice 6).
 * Processing stores the draft body with this placeholder; `SendApprovedDraft`
 * replaces exactly this string with the real `${PUBLIC_APP_URL}/quote/<token>`
 * link when the quote is sent. Amounts, lines, and assumptions never change
 * at send time — only the link materializes.
 */
export const QUOTE_LINK_PLACEHOLDER = "{{quoteLink}}";

/** PublicQuote JSON shape (docs/PLAN.md "JSON shapes the UI needs"). */
export interface PublicQuote {
  readonly businessName: string;
  /** `superseded`/`expired` exist for type completeness; an expired or
   * superseded token is a 404 on both public routes and is never displayed. */
  readonly status: QuoteVersionStatus;
  readonly currency: string;
  readonly lines: ReadonlyArray<{
    readonly name: string;
    readonly quantity?: number;
    readonly amountMinor: number;
  }>;
  readonly assumptions: readonly string[];
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly validUntil: string;
  /** True only while the customer can still decide: `sent` and unexpired. */
  readonly canDecide: boolean;
}

/**
 * Builds a `prepared` quote version row from a priceable snapshot. The
 * snapshot is copied value-by-value, so the row is immutable even if the
 * price-list input object is later mutated or re-read.
 */
export function quoteVersionOf(
  fields: {
    readonly id: string;
    readonly organizationId: string;
    readonly conversationId: string;
    readonly draftRevisionId: string | null;
  },
  quote: PriceableQuote,
  now: string,
): QuoteVersion {
  return {
    ...fields,
    status: "prepared",
    tokenHash: null,
    lines: quote.lines.map((line) => ({ ...line })),
    assumptions: [...quote.assumptions],
    currency: quote.currency,
    subtotalMinor: quote.subtotalMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    priceListVersion: quote.priceListVersion,
    validUntil: null,
    sentAt: null,
    decidedAt: null,
    decision: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Integer minor units as a fixed two-decimal display amount. */
export function formatMinor(currency: string, amountMinor: number): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

export interface QuoteBodyInput {
  readonly greeting?: string;
  readonly closing?: string;
  /** The priced snapshot the body renders (deterministic, in code). */
  readonly quote: PriceableQuote;
  /** From `organization.json` (`quoteValidityDays`). */
  readonly quoteValidityDays: number;
}

/**
 * Deterministic quote body (PLAN.md "Body rendering"): greeting + line
 * items (name, quantity, amount) + assumptions + subtotal/tax/total +
 * validity + the accept-link placeholder + closing. The body contains
 * digits and a currency by design — only the drafter's optional wrapper
 * wording obeys the drop rule; the substance is rendered here, in code.
 */
export function buildQuoteBody(input: QuoteBodyInput): string {
  const lines = input.quote.lines.map((line) => {
    const quantity = line.quantity !== undefined ? ` × ${line.quantity}` : "";
    return `${line.name}${quantity}: ${formatMinor(input.quote.currency, line.amountMinor)}`;
  });
  const parts: string[] = [];
  if (input.greeting) {
    parts.push(input.greeting);
  }
  parts.push(["Here is your quote:", ...lines].join("\n"));
  if (input.quote.assumptions.length > 0) {
    parts.push(
      ["Assumptions:", ...input.quote.assumptions.map((a) => `- ${a}`)].join(
        "\n",
      ),
    );
  }
  parts.push(
    [
      `Subtotal: ${formatMinor(input.quote.currency, input.quote.subtotalMinor)}`,
      `Tax: ${formatMinor(input.quote.currency, input.quote.taxMinor)}`,
      `Total: ${formatMinor(input.quote.currency, input.quote.totalMinor)}`,
    ].join("\n"),
  );
  parts.push(
    `This quote is valid for ${input.quoteValidityDays} days from when it is sent.`,
  );
  parts.push(`View and respond to your quote here: ${QUOTE_LINK_PLACEHOLDER}`);
  if (input.closing) {
    parts.push(input.closing);
  }
  return parts.join("\n\n");
}

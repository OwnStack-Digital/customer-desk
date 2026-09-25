/**
 * Pure in-code pricing (PLAN.md slice 6, "Pricing inputs"). `buildQuote`
 * never touches a database, the clock, or IO: it maps extracted request
 * lines onto price rules and returns an immutable snapshot or an
 * unpriceable result with one reason per problem line. Unsupported or
 * unpriceable work never produces a sendable quote — the caller parks the
 * conversation as `needs_human` (docs/PLAN.md hard rule: no free-form price
 * typed into a body ever becomes the total).
 *
 * Money math is frozen: integer minor units only, round half up exactly
 * once per line, and the tax total is the **sum of rounded line taxes** —
 * never a second rounding of the subtotal.
 */

import type { PriceList, PriceRule } from "./config";

/** One extracted customer line (the classifier's `quoteRequest.lines`). */
export interface QuoteRequestLine {
  /** A known price-rule id, when the extractor recognized one. */
  readonly ruleId?: string;
  readonly label: string;
  /** Positive integer quantities only (docs/PLAN.md frozen choice). */
  readonly quantity?: number;
}

/** One priced line of the immutable quote snapshot. */
export interface PricedQuoteLine {
  readonly ruleId: string;
  /** The rule's customer-facing label. */
  readonly name: string;
  readonly quantity?: number;
  readonly amountMinor: number;
}

/** The priced snapshot: what a `prepared` quote version persists verbatim. */
export interface PriceableQuote {
  readonly kind: "priceable";
  readonly lines: readonly PricedQuoteLine[];
  /** Recorded assumptions, in line order (defaults, minimum charges). */
  readonly assumptions: readonly string[];
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly priceListVersion: string;
}

/** Per-line reasons why the request cannot be priced. Never sendable. */
export interface UnpriceableQuote {
  readonly kind: "unpriceable";
  readonly reasons: readonly string[];
}

export type QuoteResult = PriceableQuote | UnpriceableQuote;

/**
 * Builds the priced snapshot (PLAN.md task 6.1). Every line must match a
 * rule id or a configured alias (case-insensitive); a `per_unit` line
 * needs a customer quantity or a configured `defaultQuantity` (the
 * default is recorded as an assumption); `minimumChargeMinor` raises a
 * lower line and is listed as an assumption. Duplicate request lines are
 * priced independently as separate lines — no merging, the operator
 * sees exactly what was asked. Tax follows the price list's mode:
 * `exclusive` adds per-line tax on top, `inclusive` extracts the
 * per-line tax portion out of the line amount, `none` is untaxed.
 */
export function buildQuote(
  priceList: PriceList,
  request: { readonly lines: readonly QuoteRequestLine[] },
): QuoteResult {
  if (request.lines.length === 0) {
    return { kind: "unpriceable", reasons: ["No work items to price."] };
  }

  const assumptions: string[] = [];
  const lines: PricedQuoteLine[] = [];
  const reasons: string[] = [];

  for (const requested of request.lines) {
    const rule = matchRule(priceList, requested);
    if (!rule) {
      reasons.push(`No price rule matches "${requested.label}".`);
      continue;
    }
    let quantity: number | undefined;
    let base: number;
    if (rule.kind === "per_unit") {
      const resolved = requested.quantity ?? rule.defaultQuantity;
      if (requested.quantity === undefined && resolved !== undefined) {
        // A configured default is recorded as an assumption — distinct
        // from a customer-supplied quantity, which is never listed.
        assumptions.push(
          `Assumed quantity ${resolved} ${rule.unit ?? "(unit)"}(s) for "${rule.label}".`,
        );
      }
      if (resolved === undefined) {
        reasons.push(
          `"${rule.label}" needs a quantity${rule.unit ? ` of ${rule.unit}(s)` : ""}.`,
        );
        continue;
      }
      if (!isPositiveInteger(resolved)) {
        reasons.push(
          `"${rule.label}" needs a positive whole-number quantity${rule.unit ? ` of ${rule.unit}(s)` : ""}.`,
        );
        continue;
      }
      quantity = resolved;
      base = rule.amountMinor * resolved;
    } else {
      base = rule.amountMinor;
    }
    let amountMinor = base;
    if (
      rule.minimumChargeMinor !== undefined &&
      base < rule.minimumChargeMinor
    ) {
      amountMinor = rule.minimumChargeMinor;
      assumptions.push(`Applied the minimum charge to "${rule.label}".`);
    }
    lines.push({
      ruleId: rule.id,
      name: rule.label,
      ...(rule.kind === "per_unit" ? { quantity } : {}),
      amountMinor,
    });
  }

  if (reasons.length > 0) {
    return { kind: "unpriceable", reasons: [...reasons] };
  }

  return totalsOf(priceList, lines, assumptions);
}

/** Subtotal/tax/total per the frozen money rules, once-per-line rounding. */
function totalsOf(
  priceList: PriceList,
  lines: readonly PricedQuoteLine[],
  assumptions: string[],
): PriceableQuote {
  const bps = priceList.taxMode === "none" ? 0 : (priceList.taxRateBps ?? 0);
  let subtotalMinor = 0;
  let taxMinor = 0;
  let totalMinor = 0;
  for (const line of lines) {
    const lineTax =
      priceList.taxMode === "exclusive"
        ? // Tax added on top: one half-up rounding per line, never the sum.
          roundHalfUp(line.amountMinor * bps, 10_000)
        : priceList.taxMode === "inclusive"
          ? // Line amounts contain tax; extract the portion once per line.
            roundHalfUp(line.amountMinor * bps, 10_000 + bps)
          : 0;
    subtotalMinor +=
      priceList.taxMode === "inclusive"
        ? line.amountMinor - lineTax
        : line.amountMinor;
    taxMinor += lineTax;
    totalMinor +=
      priceList.taxMode === "inclusive"
        ? line.amountMinor
        : line.amountMinor + lineTax;
  }
  return {
    kind: "priceable",
    lines: lines.map((line) => ({ ...line })),
    assumptions: [...assumptions],
    subtotalMinor,
    taxMinor,
    totalMinor,
    currency: priceList.currency,
    priceListVersion: priceList.version,
  };
}

/** `p / q` rounded half up, for non-negative integers (money math rule). */
function roundHalfUp(p: number, q: number): number {
  return Math.floor((2 * p + q) / (2 * q));
}

/** Rule id first, then case-insensitive label/alias match. */
function matchRule(
  priceList: PriceList,
  requested: QuoteRequestLine,
): PriceRule | undefined {
  if (requested.ruleId !== undefined) {
    const byId = priceList.rules.find((rule) => rule.id === requested.ruleId);
    if (byId) {
      return byId;
    }
  }
  const label = requested.label.trim().replace(/\s+/g, " ").toLowerCase();
  const normalize = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLowerCase();
  return priceList.rules.find(
    (rule) =>
      normalize(rule.label) === label ||
      (rule.aliases ?? []).some((alias) => normalize(alias) === label),
  );
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

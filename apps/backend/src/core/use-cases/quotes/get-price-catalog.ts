import type { PriceList } from "../../domain/config";
import type { PriceListRepository } from "../../ports/price-list-repository";

/** A rule the operator may select. Amounts are not editable here. */
export interface PriceCatalogRule {
  readonly id: string;
  readonly group?: string;
  readonly label: string;
  readonly kind: PriceList["rules"][number]["kind"];
  readonly unit?: string;
  /** Later visits use this rule. The first visit uses this other rule. */
  readonly initialRuleId?: string;
}

export interface PriceCatalog {
  readonly currency: string;
  readonly version: string;
  readonly rules: readonly PriceCatalogRule[];
}

/**
 * Read-only price catalog for the revise-quote form. The operator picks
 * rules and quantities; `buildQuote` still computes the money.
 */
export class GetPriceCatalog {
  constructor(private readonly priceList: PriceListRepository) {}

  run(): PriceCatalog {
    const list = this.priceList.getPriceList();
    return {
      currency: list.currency,
      version: list.version,
      rules: list.rules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        kind: rule.kind,
        ...(rule.group ? { group: rule.group } : {}),
        ...(rule.unit ? { unit: rule.unit } : {}),
        ...(rule.initialRuleId ? { initialRuleId: rule.initialRuleId } : {}),
      })),
    };
  }
}

export const GET_PRICE_CATALOG = "GetPriceCatalog";

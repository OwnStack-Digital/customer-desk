/**
 * Domain types for the file-managed tenant configuration. Plain TypeScript,
 * no framework imports (see docs/ARCHITECTURE.md "Hard rules").
 */

export type TaxMode = "none" | "inclusive" | "exclusive";

export interface OrganizationProfile {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  /** ISO 4217 code, e.g. "AUD". */
  readonly currency: string;
  readonly fromAddress: string;
  readonly quoteValidityDays: number;
  readonly taxMode: TaxMode;
  readonly mailboxId: string;
}

export interface KnowledgeBlock {
  /** Stable fact id, e.g. "kb_hours". FAQ drafts cite these ids. */
  readonly id: string;
  readonly tags: readonly string[];
  readonly text: string;
}

export interface KnowledgeBase {
  readonly version: string;
  readonly blocks: readonly KnowledgeBlock[];
}

export type PriceRuleKind = "fixed" | "per_unit";

export interface PriceRule {
  readonly id: string;
  readonly kind: PriceRuleKind;
  readonly label: string;
  /** Positive integer minor units (cents). */
  readonly amountMinor: number;
  readonly aliases?: readonly string[];
  /** Billing unit for per_unit rules, e.g. "bedroom". */
  readonly unit?: string;
  /** Assumed quantity for per_unit rules when the customer gives none. */
  readonly defaultQuantity?: number;
  readonly minimumChargeMinor?: number;
}

export interface PriceList {
  readonly version: string;
  readonly currency: string;
  readonly taxMode: TaxMode;
  /** Required unless taxMode is "none" (basis points, e.g. 1000 = 10%). */
  readonly taxRateBps?: number;
  readonly rules: readonly PriceRule[];
}

export interface MailboxBinding {
  readonly id: string;
  readonly address: string;
}

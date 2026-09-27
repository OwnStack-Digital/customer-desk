import { z } from "zod";

/**
 * Boot fails on any config error; there is no empty fallback
 * (docs/PLAN.md "Frozen choices" — config format).
 */
export class ConfigValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigValidationError";
  }
}

const nonEmpty = z.string().min(1);
const currencyCode = z.string().length(3);
const taxMode = z.enum(["none", "inclusive", "exclusive"]);
const positiveInt = z.number().int().positive();

export const organizationSchema = z.strictObject({
  id: nonEmpty,
  name: nonEmpty,
  timezone: nonEmpty,
  currency: currencyCode,
  fromAddress: z.email(),
  quoteValidityDays: positiveInt,
  taxMode: taxMode,
  mailboxId: nonEmpty,
});

export const mailboxesSchema = z.strictObject({
  // One deployment ingests from exactly one mailbox (docs/ARCHITECTURE.md
  // "Trust boundaries").
  mailboxes: z
    .array(
      z.strictObject({
        id: nonEmpty,
        address: z.email(),
      }),
    )
    .length(1),
});

export const knowledgeBaseSchema = z.strictObject({
  version: nonEmpty,
  blocks: z
    .array(
      z.strictObject({
        id: nonEmpty,
        tags: z.array(nonEmpty).min(1),
        text: nonEmpty,
      }),
    )
    .refine(
      (blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length,
      {
        message: "knowledge block ids must be unique",
      },
    ),
});

export const priceRuleSchema = z.strictObject({
  id: nonEmpty,
  group: nonEmpty.optional(),
  kind: z.enum(["fixed", "per_unit"]),
  label: nonEmpty,
  amountMinor: positiveInt,
  aliases: z.array(nonEmpty).optional(),
  unit: nonEmpty.optional(),
  defaultQuantity: positiveInt.optional(),
  minimumChargeMinor: positiveInt.optional(),
  initialRuleId: nonEmpty.optional(),
});

export const priceListSchema = z.strictObject({
  version: nonEmpty,
  currency: currencyCode,
  taxMode: taxMode,
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  rules: z
    .array(priceRuleSchema)
    .min(1)
    .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, {
      message: "price rule ids must be unique",
    })
    .refine(
      (rules) =>
        rules.every((rule) => {
          if (!rule.initialRuleId) {
            return true;
          }
          if (rule.initialRuleId === rule.id) {
            return false;
          }
          const initial = rules.find((item) => item.id === rule.initialRuleId);
          return initial !== undefined && initial.initialRuleId === undefined;
        }),
      {
        message:
          "initialRuleId must name another price rule that is not itself a follow-on rate",
      },
    ),
});

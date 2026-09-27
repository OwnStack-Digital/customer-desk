import { describe, expect, it } from "vitest";
import type { PriceList } from "./config";
import type { PriceableQuote } from "./pricing";
import { buildQuote } from "./pricing";
import { buildQuoteBody } from "./quote";

/**
 * Slice 6 domain tests (PLAN.md task 6.1). Pure: these tests never open a
 * database — `buildQuote` is a plain function over config-shaped inputs.
 */

const OVEN_RULE = {
  id: "oven_clean",
  kind: "fixed" as const,
  label: "Oven clean",
  amountMinor: 6500,
  aliases: ["oven"],
};

const baseList: PriceList = {
  version: "pl-1",
  currency: "AUD",
  taxMode: "exclusive",
  taxRateBps: 1000,
  rules: [
    {
      id: "regular_clean",
      kind: "per_unit",
      label: "Regular clean",
      unit: "bedroom",
      amountMinor: 4500,
      minimumChargeMinor: 9000,
      aliases: ["clean", "regular clean"],
    },
    OVEN_RULE,
  ],
};

function list(overrides: Partial<PriceList> = {}): PriceList {
  return { ...baseList, ...overrides };
}

function price(
  priceList: PriceList,
  lines: Array<{ ruleId?: string; label: string; quantity?: number }>,
) {
  return buildQuote(priceList, { lines });
}

/** Narrows to the priceable variant; fails the test otherwise. */
function priceable(quote: ReturnType<typeof price>): PriceableQuote {
  expect(quote.kind).toBe("priceable");
  return quote as PriceableQuote;
}

describe("buildQuote (task 6.1)", () => {
  it("prices a fixed rule", () => {
    const quote = priceable(
      price(list(), [{ ruleId: "oven_clean", label: "Oven clean" }]),
    );
    expect(quote).toEqual({
      kind: "priceable",
      lines: [{ ruleId: "oven_clean", name: "Oven clean", amountMinor: 6500 }],
      assumptions: [],
      subtotalMinor: 6500,
      taxMinor: 650,
      totalMinor: 7150,
      currency: "AUD",
      priceListVersion: "pl-1",
    });
  });

  it("prices a per_unit rule with a customer quantity", () => {
    const quote = priceable(
      price(list(), [
        { ruleId: "regular_clean", label: "Regular clean", quantity: 3 },
      ]),
    );
    expect(quote.lines).toEqual([
      {
        ruleId: "regular_clean",
        name: "Regular clean",
        quantity: 3,
        amountMinor: 13_500,
      },
    ]);
    expect(quote.subtotalMinor).toBe(13_500);
    expect(quote.taxMinor).toBe(1350);
    expect(quote.totalMinor).toBe(14_850);
    expect(quote.assumptions).toEqual([]);
  });

  it("raises a low line to the minimum charge and lists the assumption", () => {
    const quote = priceable(
      price(list(), [
        { ruleId: "regular_clean", label: "Regular clean", quantity: 1 },
      ]),
    );
    expect(quote.lines).toEqual([
      {
        ruleId: "regular_clean",
        name: "Regular clean",
        quantity: 1,
        amountMinor: 9000,
      },
    ]);
    expect(quote.subtotalMinor).toBe(9000);
    expect(quote.assumptions).toEqual([
      'Applied the minimum charge to "Regular clean".',
    ]);
  });

  it("uses defaultQuantity as an assumption, distinct from a given quantity", () => {
    const withDefault = list({
      rules: [
        {
          id: "regular_clean",
          kind: "per_unit",
          label: "Regular clean",
          unit: "bedroom",
          amountMinor: 4500,
          defaultQuantity: 2,
        },
      ],
    });
    const assumed = priceable(price(withDefault, [{ label: "regular clean" }]));
    expect(assumed.lines).toEqual([
      {
        ruleId: "regular_clean",
        name: "Regular clean",
        quantity: 2,
        amountMinor: 9000,
      },
    ]);
    expect(assumed.assumptions).toEqual([
      'Assumed quantity 2 bedroom(s) for "Regular clean".',
    ]);
    // A customer-supplied quantity is never listed as an assumption.
    const given = priceable(
      price(withDefault, [{ label: "regular clean", quantity: 4 }]),
    );
    expect(given.lines[0]).toMatchObject({ quantity: 4 });
    expect(given.assumptions).toEqual([]);
  });

  it("per_unit without a quantity and without a default is unpriceable", () => {
    expect(price(list(), [{ label: "regular clean" }])).toEqual({
      kind: "unpriceable",
      reasons: ['"Regular clean" needs a quantity of bedroom(s).'],
    });
  });

  it("rejects a non-positive or non-integer quantity", () => {
    expect(price(list(), [{ label: "clean", quantity: 0 }])).toMatchObject({
      kind: "unpriceable",
    });
    expect(price(list(), [{ label: "clean", quantity: -2 }])).toMatchObject({
      kind: "unpriceable",
    });
    expect(price(list(), [{ label: "clean", quantity: 1.5 }])).toMatchObject({
      kind: "unpriceable",
    });
  });

  it("an unknown label or rule id is unpriceable, never priced", () => {
    expect(price(list(), [{ label: "gutter clearing" }])).toEqual({
      kind: "unpriceable",
      reasons: ['No price rule matches "gutter clearing".'],
    });
    expect(
      price(list(), [{ ruleId: "no_such_rule", label: "No such rule" }]),
    ).toEqual({
      kind: "unpriceable",
      reasons: ['No price rule matches "No such rule".'],
    });
  });

  it("matches aliases case-insensitively on label and aliases", () => {
    const quote = priceable(
      price(list(), [
        { label: "OVEN" },
        { label: "Regular  Clean", quantity: 2 },
      ]),
    );
    expect(quote.lines.map((line) => line.ruleId)).toEqual([
      "oven_clean",
      "regular_clean",
    ]);
  });

  it("tax exclusive: per-line tax added on top", () => {
    const quote = priceable(price(list(), [{ label: "oven" }]));
    expect(quote.subtotalMinor).toBe(6500);
    expect(quote.taxMinor).toBe(650);
    expect(quote.totalMinor).toBe(7150);
  });

  it("tax inclusive: line amounts contain tax; the portion is extracted", () => {
    const quote = priceable(
      price(list({ taxMode: "inclusive" }), [{ label: "oven" }]),
    );
    // 6500 gross at 10%: tax portion 6500*1000/11000 = 590.90… -> 591.
    expect(quote.subtotalMinor).toBe(5909);
    expect(quote.taxMinor).toBe(591);
    expect(quote.totalMinor).toBe(6500);
  });

  it("tax none: no tax regardless of taxRateBps", () => {
    const quote = priceable(
      price(list({ taxMode: "none", taxRateBps: undefined }), [
        { label: "oven" },
      ]),
    );
    expect(quote.subtotalMinor).toBe(6500);
    expect(quote.taxMinor).toBe(0);
    expect(quote.totalMinor).toBe(6500);
  });

  it("rounds half up once per line, never of the subtotal", () => {
    // Two lines of 2500 at 0.05%: per-line tax 1.25 -> 1 each (half-up),
    // sum 2. Rounding the subtotal (5000 -> 2.5) would give 3 instead.
    const quote = priceable(
      price(
        list({
          taxRateBps: 5,
          rules: [
            { id: "tiny", kind: "fixed", label: "Tiny", amountMinor: 2500 },
          ],
        }),
        [{ label: "tiny" }, { label: "tiny" }],
      ),
    );
    expect(quote.subtotalMinor).toBe(5000);
    expect(quote.taxMinor).toBe(2);
    expect(quote.totalMinor).toBe(5002);

    // A .5 fraction rounds up: 5 at 10% is exactly 0.5 -> 1.
    const halfUp = priceable(
      price(
        list({
          taxRateBps: 1000,
          rules: [{ id: "five", kind: "fixed", label: "Five", amountMinor: 5 }],
        }),
        [{ label: "five" }],
      ),
    );
    expect(halfUp.taxMinor).toBe(1);
    expect(halfUp.totalMinor).toBe(6);
  });

  it("prices duplicate lines independently as separate lines", () => {
    const quote = priceable(
      price(list(), [
        { ruleId: "oven_clean", label: "Oven clean" },
        { ruleId: "oven_clean", label: "Oven clean" },
      ]),
    );
    expect(quote.lines).toHaveLength(2);
    expect(quote.subtotalMinor).toBe(13_000);
  });

  it("prices a recurring clean as a first visit plus a later rate not in the total", () => {
    const quote = priceable(
      price(
        list({
          rules: [
            {
              id: "one_time_clean",
              kind: "per_unit",
              label: "One-time clean",
              unit: "bedroom",
              amountMinor: 6500,
              minimumChargeMinor: 13000,
            },
            {
              id: "recurring_clean",
              kind: "per_unit",
              label: "Recurring clean",
              unit: "bedroom",
              amountMinor: 4500,
              minimumChargeMinor: 9000,
              initialRuleId: "one_time_clean",
            },
          ],
        }),
        [{ ruleId: "recurring_clean", label: "weekly", quantity: 3 }],
      ),
    );
    expect(quote.lines).toEqual([
      {
        ruleId: "one_time_clean",
        name: "One-time clean",
        quantity: 3,
        amountMinor: 19_500,
      },
      {
        ruleId: "recurring_clean",
        name: "Recurring clean",
        quantity: 3,
        amountMinor: 13_500,
        includedInTotal: false,
      },
    ]);
    expect(quote.subtotalMinor).toBe(19_500);
    expect(quote.taxMinor).toBe(1950);
    expect(quote.totalMinor).toBe(21_450);
    const body = buildQuoteBody({
      quote,
      quoteValidityDays: 14,
    });
    expect(body).toContain("One-time clean × 3: AUD 195.00");
    expect(body).toContain(
      "Each following visit is not included in the total:",
    );
    expect(body).toContain("Recurring clean × 3: AUD 135.00");
    expect(body).toContain("Total: AUD 214.50");
    expect(body).not.toContain("Total: AUD 349.50");
  });

  it("reports every problem line, and no request lines at all is unpriceable", () => {
    expect(price(list(), [])).toEqual({
      kind: "unpriceable",
      reasons: ["No work items to price."],
    });
    expect(price(list(), [{ label: "oven" }, { label: "mystery" }])).toEqual({
      kind: "unpriceable",
      reasons: ['No price rule matches "mystery".'],
    });
  });

  it("a computed snapshot is not altered by later changes to the price list", () => {
    // A local mutable copy of the catalog: the test mutates it after
    // computing, proving the snapshot holds by value, never by reference
    // into the config (price lists are frozen at boot, but the guarantee
    // must hold regardless).
    const rules = [
      {
        id: "oven_clean",
        kind: "fixed" as const,
        label: "Oven Clean",
        amountMinor: 6500,
        aliases: ["oven"],
      },
    ];
    const mutable = list({ rules });
    const quote = priceable(price(mutable, [{ label: "oven" }]));
    const [rule] = rules;
    if (rule) {
      rule.amountMinor = 1;
    }
    (mutable as { currency: string }).currency = "USD";
    (mutable as { version: string }).version = "pl-2";
    expect(quote.lines[0]).toMatchObject({ amountMinor: 6500 });
    expect(quote.subtotalMinor).toBe(6500);
    expect(quote.totalMinor).toBe(7150);
    expect(quote.currency).toBe("AUD");
    expect(quote.priceListVersion).toBe("pl-1");
  });
});

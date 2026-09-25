import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "./loader";
import { ConfigValidationError } from "./schemas";

const sampleOrganization = {
  id: "org_harbour_pine",
  name: "Harbour & Pine Cleaning",
  timezone: "Australia/Sydney",
  currency: "AUD",
  fromAddress: "hello@harbourandpine.example",
  quoteValidityDays: 14,
  taxMode: "exclusive",
  mailboxId: "mbx_harbour_pine",
};

const sampleMailboxes = {
  mailboxes: [
    { id: "mbx_harbour_pine", address: "hello@harbourandpine.example" },
  ],
};

const sampleKnowledgeBase = {
  version: "kb-1",
  blocks: [
    {
      id: "kb_hours",
      tags: ["hours", "open"],
      text: "We clean Monday to Friday, 8am to 5pm, and Saturdays 9am to 1pm.",
    },
  ],
};

const samplePriceList = {
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
    {
      id: "oven_clean",
      kind: "fixed",
      label: "Oven clean",
      amountMinor: 6500,
      aliases: ["oven"],
    },
  ],
};

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfigDir(overrides: {
  organization?: Record<string, unknown>;
  mailboxes?: Record<string, unknown>;
  knowledgeBase?: Record<string, unknown>;
  priceList?: Record<string, unknown>;
  omit?: "organization" | "mailboxes" | "knowledgeBase" | "priceList";
}): string {
  const dir = mkdtempSync(join(tmpdir(), "bos-config-"));
  tempDirs.push(dir);
  const files: Record<string, unknown> = {
    "organization.json": overrides.organization ?? sampleOrganization,
    "mailboxes.json": overrides.mailboxes ?? sampleMailboxes,
    "knowledge-base.json": overrides.knowledgeBase ?? sampleKnowledgeBase,
    "price-list.json": overrides.priceList ?? samplePriceList,
  };
  for (const [name, contents] of Object.entries(files)) {
    if (overrides.omit && overrides.omit === keyFor(name)) {
      continue;
    }
    writeFileSync(join(dir, name), `${JSON.stringify(contents, null, 2)}\n`);
  }
  return dir;
}

function keyFor(fileName: string): string {
  return fileName
    .replace(/\.json$/, "")
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function expectLoadFails(dir: string, messagePart: string): void {
  let error: unknown;
  try {
    loadConfig(dir);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ConfigValidationError);
  expect((error as Error).message).toContain(messagePart);
}

describe("loadConfig (fails closed)", () => {
  it("loads a valid tenant configuration", () => {
    const config = loadConfig(makeConfigDir({}));
    expect(config.organization.id).toBe("org_harbour_pine");
    expect(config.mailboxes).toHaveLength(1);
    expect(config.knowledgeBase.blocks[0]?.id).toBe("kb_hours");
    expect(config.priceList.rules).toHaveLength(2);
  });

  it("refuses to load when a config file is missing", () => {
    const dir = makeConfigDir({ omit: "organization" });
    expectLoadFails(dir, "cannot read config file");
  });

  it("refuses to load when a file is not valid JSON", () => {
    const dir = makeConfigDir({});
    writeFileSync(join(dir, "price-list.json"), "{ not json");
    expectLoadFails(dir, "is not valid JSON");
  });

  it("refuses to load when a required field is missing", () => {
    const { taxMode, ...withoutTaxMode } = sampleOrganization;
    expect(taxMode).toBeDefined();
    expectLoadFails(
      makeConfigDir({ organization: withoutTaxMode }),
      "organization.json: taxMode",
    );
  });

  it("refuses to load an unknown field (strict schemas)", () => {
    expectLoadFails(
      makeConfigDir({ organization: { ...sampleOrganization, orgId: "x" } }),
      "Unrecognized key",
    );
  });

  it("refuses to load when org currency does not match the price list", () => {
    expectLoadFails(
      makeConfigDir({
        organization: { ...sampleOrganization, currency: "USD" },
      }),
      "does not match price-list.json currency",
    );
  });

  it("refuses a non-none tax mode without taxRateBps", () => {
    const { taxRateBps, ...withoutRate } = samplePriceList;
    expect(taxRateBps).toBeDefined();
    expectLoadFails(
      makeConfigDir({ priceList: withoutRate }),
      "requires taxRateBps",
    );
  });

  it("refuses a price list with zero rules", () => {
    expectLoadFails(
      makeConfigDir({ priceList: { ...samplePriceList, rules: [] } }),
      "rules",
    );
  });

  it("refuses a mailbox binding that is not the organization mailbox", () => {
    expectLoadFails(
      makeConfigDir({
        mailboxes: {
          mailboxes: [
            { id: "mbx_other", address: "hello@harbourandpine.example" },
          ],
        },
      }),
      "organization.json expects",
    );
  });

  it("refuses knowledge bases with duplicate block ids", () => {
    expectLoadFails(
      makeConfigDir({
        knowledgeBase: {
          ...sampleKnowledgeBase,
          blocks: [
            ...sampleKnowledgeBase.blocks,
            sampleKnowledgeBase.blocks[0],
          ],
        },
      }),
      "unique",
    );
  });

  it("loads the committed sample configuration from the repo config dir", () => {
    // `bun run test` runs vitest from the repo root, where `config/` lives.
    const repoConfigDir = join(process.cwd(), "config");
    const config = loadConfig(repoConfigDir);
    expect(config.organization.name).toBe("Harbour & Pine Cleaning");
    expect(config.priceList.rules.map((rule) => rule.id)).toEqual([
      "regular_clean",
      "oven_clean",
    ]);
  });

  it("returns a frozen, read-only configuration", () => {
    const config = loadConfig(makeConfigDir({}));
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.organization)).toBe(true);
    expect(() => {
      (config.organization as { name?: string }).name = "mutated";
    }).toThrow();
  });
});

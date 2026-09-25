import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import type {
  KnowledgeBase,
  MailboxBinding,
  OrganizationProfile,
  PriceList,
} from "../../../core/domain/config";
import {
  ConfigValidationError,
  knowledgeBaseSchema,
  mailboxesSchema,
  organizationSchema,
  priceListSchema,
} from "./schemas";

export interface ValidatedConfig {
  readonly organization: OrganizationProfile;
  readonly mailboxes: readonly MailboxBinding[];
  readonly knowledgeBase: KnowledgeBase;
  readonly priceList: PriceList;
}

/**
 * Default: `<repo>/config`. Resolved relative to this file so it holds for
 * both `src/` (dev) and `dist/` (compiled output), which mirror each other:
 * `src|dist/adapters/outbound/config-files` is six levels below the repo root.
 */
export function defaultConfigDir(): string {
  return resolve(__dirname, "..", "..", "..", "..", "..", "..", "config");
}

export function loadConfig(
  configDir: string = process.env.CONFIG_DIR || defaultConfigDir(),
): ValidatedConfig {
  const organization = parseFile(
    configDir,
    "organization.json",
    organizationSchema,
  );
  const mailboxes = parseFile(configDir, "mailboxes.json", mailboxesSchema);
  const knowledgeBase = parseFile(
    configDir,
    "knowledge-base.json",
    knowledgeBaseSchema,
  );
  const priceList = parseFile(configDir, "price-list.json", priceListSchema);

  if (organization.currency !== priceList.currency) {
    throw new ConfigValidationError(
      `organization.json currency ${organization.currency} does not match price-list.json currency ${priceList.currency}`,
    );
  }
  if (priceList.taxMode !== "none" && priceList.taxRateBps === undefined) {
    throw new ConfigValidationError(
      `price-list.json tax mode "${priceList.taxMode}" requires taxRateBps`,
    );
  }
  const bound = mailboxes.mailboxes[0];
  if (bound.id !== organization.mailboxId) {
    throw new ConfigValidationError(
      `mailboxes.json binds mailbox "${bound.id}" but organization.json expects "${organization.mailboxId}"`,
    );
  }

  return deepFreeze({
    organization,
    mailboxes: mailboxes.mailboxes,
    knowledgeBase,
    priceList,
  });
}

function parseFile<T>(
  configDir: string,
  file: string,
  schema: z.ZodType<T>,
): T {
  const path = `${configDir}/${file}`;
  const raw = readJson(path);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${path}: ${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ConfigValidationError(issues);
  }
  return parsed.data;
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new ConfigValidationError(
      `cannot read config file ${path} (missing or unreadable)`,
      { cause },
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ConfigValidationError(`${path} is not valid JSON`, { cause });
  }
}

/** Config is trusted input: freeze it so callers cannot mutate it. */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  return value;
}

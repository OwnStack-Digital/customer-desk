/**
 * Owner → assistant actions. An instruction is not a customer email: it
 * must change the draft. Prices and labels come only from the price list;
 * FAQ sentences come only from knowledge blocks or a catalog label list.
 */

import type { KnowledgeBase, PriceList, PriceRule } from "./config";
import { formatMinor } from "./quote";

export interface InstructionLine {
  readonly ruleId?: string;
  readonly label: string;
  readonly quantity?: number;
}

const QUOTE_ASK = /\b(quote|quotes|pricing|price|prices|how much|estimate)\b/;
const RESIDENTIAL_FOCUS = /\b(residential|home cleaning|occupied)\b/;
const FOCUS_ONLY = /\b(focus|only|instead)\b/;
const BOND_WORDS = /\bbond\b|end of lease|end-of-lease|\bvacate\b/;
const RECURRING_WORDS =
  /\bweekly\b|\bfortnightly\b|\brecurring\b|\bevery week\b|\bmonthly\b|\bevery month\b/;
export function instructionWantsQuote(instruction: string): boolean {
  return QUOTE_ASK.test(instruction.toLowerCase());
}

/**
 * Lines for a customer quote. Model lines are kept only when their label or
 * alias is in this email, so an earlier thread cannot add rooms they did not ask for.
 */
export function linesForCustomerQuote(
  priceList: PriceList,
  text: string,
  modelLines: readonly InstructionLine[] = [],
): InstructionLine[] {
  const grounded = modelLines.filter((line) =>
    lineGrounded(priceList, line, text),
  );
  const lines =
    grounded.length > 0 ? grounded : quoteLinesFromText(priceList, text);
  return preferServiceLines(priceList, text.toLowerCase(), lines);
}

/** Customer-facing questions for a quote that cannot be priced yet. */
export function missingQuoteQuestions(
  priceList: PriceList,
  text: string,
  reasons: readonly string[],
): string {
  const questions = uniqueQuestions(reasons);
  const measure = unmatchedMeasure(priceList, text);
  return [
    "Thanks for asking for a quote. We need a little more information before we can price it.",
    ...questions.map((question) => `- ${question}`),
    ...(measure ? [measure] : []),
  ].join("\n");
}

function lineGrounded(
  priceList: PriceList,
  line: InstructionLine,
  text: string,
): boolean {
  const rule = line.ruleId
    ? priceList.rules.find((item) => item.id === line.ruleId)
    : undefined;
  const names = [line.label, rule?.label, ...(rule?.aliases ?? [])].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
  const haystack = text.toLowerCase();
  return names.some((name) => contains(haystack, name.toLowerCase()));
}

function questionFor(reason: string): string {
  const named = reason.match(/^"([^"]+)" needs a quantity(?: of ([^.]+))?\./);
  if (!named) {
    return `Could you clarify this: ${reason}`;
  }
  const name = named[1]?.replace(/^Recurring /, "") ?? "that work";
  const unit = named[2]?.replace(/\(s\)$/, "").trim();
  return unit
    ? `How many ${unit}s should we allow for ${name}?`
    : `What quantity should we use for ${name}?`;
}

function uniqueQuestions(reasons: readonly string[]): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const reason of reasons) {
    const question = questionFor(reason);
    const key = question.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    questions.push(question);
  }
  return questions;
}

function unmatchedMeasure(
  priceList: PriceList,
  text: string,
): string | undefined {
  const match = text.match(/\b(\d+)\s+(square meters?|sqm|sq m)\b/i);
  if (!match) {
    return undefined;
  }
  const units = priceList.rules
    .map((rule) => rule.unit?.toLowerCase())
    .filter((unit): unit is string => unit !== undefined);
  if (units.some((unit) => unit.includes("square"))) {
    return undefined;
  }
  return `You mentioned ${match[1]} ${match[2]}. That size is not on the price list, so we also need the number of hours.`;
}

export function focusesOnResidential(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return RESIDENTIAL_FOCUS.test(lower) && FOCUS_ONLY.test(lower);
}

/** Lines for an instruction. Model lines win when present; otherwise the
 * latest customer ask plus the instruction are matched to price rules. */
export function linesForInstruction(
  priceList: PriceList,
  customerText: string,
  instruction: string,
  modelLines: readonly InstructionLine[],
): InstructionLine[] {
  const source =
    modelLines.length > 0
      ? modelLines
      : quoteLinesFromText(priceList, `${customerText}\n${instruction}`);
  return excludeLines(priceList, source, instruction);
}

export function factsForInstruction(
  knowledge: KnowledgeBase,
  customerText: string,
  instruction: string,
): string[] {
  const haystack = `${instruction}\n${customerText}`.toLowerCase();
  const ids = knowledge.blocks
    .filter((block) =>
      block.tags.some((tag) => contains(haystack, tag.toLowerCase())),
    )
    .map((block) => block.id);
  if (!focusesOnResidential(instruction)) {
    return ids;
  }
  return ids.filter((id) => {
    const block = knowledge.blocks.find((item) => item.id === id);
    return !block?.tags.some((tag) => tag.toLowerCase().includes("commercial"));
  });
}

/** Catalog sentences the owner asked for. Amounts are copied from the price list. */
export function instructionNotes(
  priceList: PriceList,
  instruction: string,
): string[] {
  const notes: string[] = [];
  if (focusesOnResidential(instruction)) {
    const labels = priceList.rules
      .filter((rule) => rule.group === "Occupied home" && !rule.initialRuleId)
      .map((rule) => rule.label);
    notes.push(
      labels.length === 0
        ? "We do home cleaning."
        : `We do home cleaning: ${labels.join(", ")}.`,
    );
  }
  if (/\boptions\b/i.test(instruction)) {
    notes.push(
      ...quoteLinesFromText(priceList, instruction).flatMap((line) =>
        rateLine(priceList, line),
      ),
    );
  }
  return notes;
}

function rateLine(priceList: PriceList, line: InstructionLine): string[] {
  const rule = priceList.rules.find((item) => item.id === line.ruleId);
  if (!rule) {
    return [];
  }
  const unit = rule.unit ? ` per ${rule.unit}` : "";
  return [
    `${rule.label}: ${formatMinor(priceList.currency, rule.amountMinor)}${unit}.`,
  ];
}

/** Shown when the owner asked for a price but a quantity is missing.
 * Rates are copied from the price list. No total is invented. */
export function unpriceableInstructionBody(
  priceList: PriceList,
  lines: readonly InstructionLine[],
  reasons: readonly string[],
): string {
  const rates = lines.flatMap((line) => {
    const rule = priceList.rules.find((item) => item.id === line.ruleId);
    if (!rule || line.quantity !== undefined || rule.kind !== "per_unit") {
      return [];
    }
    return [
      `${rule.label} is ${formatMinor(priceList.currency, rule.amountMinor)} per ${rule.unit ?? "unit"}. A total needs a quantity.`,
    ];
  });
  return [
    "The quote was not finished, because it cannot be priced yet.",
    ...reasons.map((reason) => `- ${reason}`),
    ...rates,
  ].join("\n");
}

function excludeLines(
  priceList: PriceList,
  lines: readonly InstructionLine[],
  instruction: string,
): InstructionLine[] {
  const lower = instruction.toLowerCase();
  const negated = [
    ...lower.matchAll(
      /\b(?:no|not|without|remove|drop|exclude|excluding)\s+([a-z]+(?:\s+[a-z]+){0,3})/g,
    ),
  ].map((match) => match[1] ?? "");
  const dropCommercial = focusesOnResidential(instruction);
  return lines.filter((line) => {
    const rule = priceList.rules.find((item) => item.id === line.ruleId);
    const names = [line.label, rule?.label, ...(rule?.aliases ?? [])]
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.toLowerCase());
    if (
      dropCommercial &&
      (rule?.id.startsWith("commercial") ||
        names.some((name) => name.includes("commercial")))
    ) {
      return false;
    }
    return !negated.some((term) =>
      names.some((name) => name.includes(term) || term.includes(name)),
    );
  });
}

function quoteLinesFromText(
  priceList: PriceList,
  haystack: string,
): InstructionLine[] {
  const lower = haystack.toLowerCase();
  interface Candidate {
    rule: PriceRule;
    term: string;
    start: number;
    end: number;
  }
  const candidates: Candidate[] = [];
  for (const rule of priceList.rules) {
    for (const raw of [rule.label, ...(rule.aliases ?? [])]) {
      const term = raw.toLowerCase();
      const start = termIndex(lower, term);
      if (start !== -1) {
        candidates.push({ rule, term, start, end: start + term.length });
      }
    }
  }
  candidates.sort(
    (left, right) =>
      right.term.length - left.term.length || left.start - right.start,
  );
  const lines: InstructionLine[] = [];
  const taken: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.rule.id)) {
      continue;
    }
    if (
      taken.some(
        ([start, end]) => candidate.start < end && start < candidate.end,
      )
    ) {
      continue;
    }
    taken.push([candidate.start, candidate.end]);
    seen.add(candidate.rule.id);
    const line: InstructionLine = {
      ruleId: candidate.rule.id,
      label: candidate.rule.label,
    };
    if (candidate.rule.kind === "per_unit" && candidate.rule.unit) {
      const quantity = new RegExp(
        `(\\d+)[ -]*${escapeRegExp(candidate.rule.unit)}s?\\b`,
      ).exec(lower);
      if (quantity?.[1]) {
        lines.push({ ...line, quantity: Number(quantity[1]) });
        continue;
      }
    }
    lines.push(line);
  }
  return preferServiceLines(priceList, lower, lines);
}

function preferServiceLines(
  priceList: PriceList,
  haystack: string,
  lines: InstructionLine[],
): InstructionLine[] {
  const bond = BOND_WORDS.test(haystack);
  const recurring = !bond && RECURRING_WORDS.test(haystack);
  return lines.map((line) => {
    const rule = priceList.rules.find((item) => item.id === line.ruleId);
    if (!rule) {
      return line;
    }
    if (bond && rule.id.startsWith("occupied_")) {
      const bondId = `bond_${rule.id.slice("occupied_".length).replace(/_recurring$/, "")}`;
      const bondRule = priceList.rules.find((item) => item.id === bondId);
      if (bondRule) {
        return {
          ruleId: bondRule.id,
          label: bondRule.label,
          ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        };
      }
    }
    if (recurring && rule.initialRuleId === undefined) {
      const follow = priceList.rules.find(
        (item) => item.initialRuleId === rule.id,
      );
      if (follow) {
        return {
          ruleId: follow.id,
          label: follow.label,
          ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        };
      }
    }
    return line;
  });
}

function contains(haystack: string, word: string): boolean {
  return termIndex(haystack, word) !== -1;
}

function termIndex(haystack: string, word: string): number {
  if (word.includes(" ") || word.includes("-")) {
    return haystack.indexOf(word);
  }
  const match = new RegExp(`\\b${escapeRegExp(word)}\\b`).exec(haystack);
  return match ? match.index : -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

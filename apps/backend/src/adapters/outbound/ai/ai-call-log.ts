/**
 * Safe fields for an AI SDK failure. Provider errors often echo the prompt
 * and can echo the API key. Logs get a name, a status, and one redacted
 * line — never the prompt, the email, or the key.
 */

const EMAIL_FENCE = /<email>[\s\S]*?<\/email>/gi;
const SECRET = /sk-[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+\S+/gi;
const KEY_PARAM = /([?&](?:api_?key|key)=)[^&\s]+/gi;

export interface AiErrorFields {
  readonly errorName: string;
  readonly statusCode?: number;
  readonly detail: string;
}

export function aiErrorFields(error: unknown): AiErrorFields {
  const chain = causes(error);
  const named =
    chain.find((item) => {
      const name = errorName(item);
      return name !== "" && name !== "Error" && name !== "RetryError";
    }) ?? chain[0];
  const withStatus = [...chain]
    .reverse()
    .find((item) => statusCode(item) !== undefined);
  const fields: AiErrorFields = {
    errorName: named ? errorName(named) || "Error" : "Error",
    detail: sanitizeDetail(named ? messageOf(named) : ""),
  };
  const status = withStatus ? statusCode(withStatus) : undefined;
  return status === undefined ? fields : { ...fields, statusCode: status };
}

export function sanitizeDetail(value: string): string {
  const oneLine = firstLine(value)
    .replace(EMAIL_FENCE, "[redacted]")
    .replace(SECRET, "[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(KEY_PARAM, "$1[redacted]");
  return oneLine.length > 240 ? `${oneLine.slice(0, 237)}...` : oneLine;
}

function causes(error: unknown): object[] {
  const seen = new Set<object>();
  const items: object[] = [];
  let current: unknown = error;
  while (isObject(current) && !seen.has(current)) {
    seen.add(current);
    items.push(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return items;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function errorName(error: object): string {
  return "name" in error && typeof error.name === "string" ? error.name : "";
}

function statusCode(error: object): number | undefined {
  if (!("statusCode" in error) || typeof error.statusCode !== "number") {
    return undefined;
  }
  return error.statusCode;
}

function messageOf(error: object): string {
  return "message" in error && typeof error.message === "string"
    ? error.message
    : "";
}

function firstLine(value: string): string {
  const line = value.split("\n")[0] ?? "";
  return line.trim();
}

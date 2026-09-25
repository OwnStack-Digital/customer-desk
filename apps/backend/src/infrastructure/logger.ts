export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface StructuredLogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const REDACTED = "[redacted]";

/**
 * Case-insensitive: credentials/cookies and raw email body keys must never
 * reach log output (docs/ARCHITECTURE.md "Tests and operations").
 */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "token",
  "text",
  "html",
  "body",
]);

export function createLogger(
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): StructuredLogger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    // level/msg last so caller fields cannot spoof them.
    const safeFields = redact(fields) as Record<string, unknown>;
    const record = { ...safeFields, level, msg: message };
    sink(JSON.stringify(record));
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitive(key) ? REDACTED : redact(item);
    }
    return out;
  }
  return value;
}

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

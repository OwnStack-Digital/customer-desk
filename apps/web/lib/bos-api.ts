import "server-only";

export const DEFAULT_BOS_API_URL = "http://127.0.0.1:3001";

/**
 * Base URL of the BOS API. Server-only: the web app never talks to the
 * database or backend source, only to this HTTP endpoint
 * (docs/DECISIONS.md §5).
 */
export function bosApiUrl(): string {
  return process.env.BOS_API_URL ?? DEFAULT_BOS_API_URL;
}

export class BosApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BosApiError";
  }
}

/**
 * Typed fetch helper for the BOS API. Error bodies follow the backend
 * contract: { "error": { "code": string, "message": string } }.
 */
export async function bosApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, bosApiUrl()), init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // non-JSON error body; keep the status line
    }
    throw new BosApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/** Shape returned by GET /health. */
export type Health = { status: "ok" };

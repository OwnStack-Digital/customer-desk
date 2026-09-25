import "server-only";
import { cookies } from "next/headers";

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
  const response = await bosApiRaw(path, init);
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

/**
 * Raw transport for calls that need more than the JSON body, such as the
 * login/logout Set-Cookie headers (transport-only web responsibility).
 */
export async function bosApiRaw(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(new URL(path, bosApiUrl()), init);
}

/** Copies every API Set-Cookie header onto the browser via Next cookies. */
export async function forwardSetCookies(response: Response): Promise<void> {
  const jar = await cookies();
  for (const setCookie of response.headers.getSetCookie()) {
    const nameValue = setCookie.split(";")[0] ?? "";
    const eq = nameValue.indexOf("=");
    if (eq < 1) {
      continue;
    }
    jar.set(
      nameValue.slice(0, eq).trim(),
      nameValue.slice(eq + 1).trim(),
      parseCookieAttributes(setCookie),
    );
  }
}

type NextCookieOptions = NonNullable<
  Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2]
>;

function parseCookieAttributes(setCookie: string): NextCookieOptions {
  const options: Record<string, unknown> = {};
  for (const attribute of setCookie.split(";").slice(1)) {
    const eq = attribute.indexOf("=");
    const key = (eq < 0 ? attribute : attribute.slice(0, eq))
      .trim()
      .toLowerCase();
    const value = eq < 0 ? "" : attribute.slice(eq + 1).trim();
    if (key === "httponly") {
      options.httpOnly = true;
    } else if (key === "secure") {
      options.secure = true;
    } else if (key === "path") {
      options.path = value;
    } else if (key === "samesite") {
      options.sameSite = value.toLowerCase();
    } else if (key === "max-age") {
      options.maxAge = Number(value);
    } else if (key === "expires") {
      options.expires = new Date(value);
    }
  }
  return options as NextCookieOptions;
}

/** Shape returned by GET /health. */
export type Health = { status: "ok" };

/** Shape returned by POST /auth/login. */
export type LoginResponse = { operator: { email: string } };

/**
 * Shape returned by GET /inbox. Slice 1 always renders an empty list; slice
 * 2 replaces `unknown` with the real InboxItem from docs/PLAN.md.
 */
export type Inbox = { items: unknown[] };

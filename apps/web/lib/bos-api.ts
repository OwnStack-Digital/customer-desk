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

/** Processing state of a message (classifier lanes land in slice 3). */
export type ProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "needs_human"
  | "failed";

/** InboxItem from docs/PLAN.md "JSON shapes the UI needs". */
export type InboxItem = {
  conversationId: string;
  from: { address: string; name?: string };
  subject?: string;
  latestAt: string;
  lane?:
    | "faq"
    | "quote"
    | "service"
    | "complaint"
    | "quote_reply"
    | "other"
    | "noise";
  processing: ProcessingStatus;
  urgent: boolean;
  automationPaused: boolean;
  preview: string;
  /** Newest non-superseded quote, including a recorded accept/decline. */
  quoteStatus?: "prepared" | "sent" | "accepted" | "declined";
};

/** Shape returned by GET /inbox. */
export type InboxPage = { items: InboxItem[] };

/** Owner inbox filters (GET /inbox?filter=...). */
export const INBOX_FILTERS = ["all", "needs_human", "complaints"] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Draft section of the thread (slice 4; slice 6 adds quote totals). */
export type ThreadDraft = {
  revisionId: string;
  status: "proposed" | "approved";
  bodyText: string;
  assumptions: string[];
  factIds?: string[];
  /** Present only on a quote-linked draft: from the immutable snapshot. */
  totalMinor?: number;
  currency?: string;
};

/** Result of a review action: the draft revision the action left in place. */
export type ReviewedDraft = {
  revisionId: string;
  status: "proposed" | "approved" | "consumed" | "discarded" | "superseded";
  bodyText: string;
};

/** Shape returned by POST /drafts/:revisionId/send (idempotent 200). */
export type SendResult = {
  messageId: string;
  conversationId: string;
  revisionId: string;
};

/** One row of GET /outbox (docs/PLAN.md slice 5). */
export type OutboxItem = {
  messageId: string;
  conversationId: string;
  recipient: string;
  status: "queued" | "sending" | "sent" | "failed" | "uncertain";
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

/** Shape returned by GET /outbox. */
export type OutboxPage = { items: OutboxItem[] };

/** Thread from docs/PLAN.md (slice 3 adds processing, slice 4 the draft). */
export type Thread = {
  conversation: {
    id: string;
    customer: { address: string; name?: string };
    subject?: string;
    automationPaused: boolean;
  };
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound" | "instruction";
    at: string;
    from: string;
    subject?: string;
    text?: string;
  }>;
  processing?: {
    status: ProcessingStatus;
    lane?: InboxItem["lane"];
    summary: string;
  };
  draft?: ThreadDraft;
  /** Internal service note (slice 7): request, details, next owner action. */
  serviceNote?: {
    request: string;
    supplied: string[];
    missing: string[];
    nextAction: string;
  };
  /** Quote-reply intent and candidate quote versions (slice 7). */
  quoteReply?: {
    intent: "accept" | "decline" | "change" | "unclear";
    candidateQuoteVersionIds: string[];
  };
  /** The conversation's open (prepared/sent) quote version (slice 6). */
  openQuote?: {
    quoteVersionId: string;
    status: string;
    totalMinor: number;
    currency: string;
  };
  /** Newest quote still visible to the owner, including accept/decline. */
  quote?: ThreadQuote;
  /** Every non-superseded quote, oldest first, including a declined one. */
  quotes: ThreadQuote[];
  /** Received mail, sent mail, and actions, oldest first. */
  timeline: ThreadTimelineEntry[];
};

export type ThreadTimelineEntry =
  | {
      kind: "received" | "sent" | "instruction";
      id: string;
      at: string;
      from: string;
      subject?: string;
      text?: string;
    }
  | {
      kind: "event";
      id: string;
      at: string;
      actor: string;
      action: string;
      label: string;
    };

export type ThreadQuote = {
  quoteVersionId: string;
  status: "prepared" | "sent" | "accepted" | "declined";
  totalMinor: number;
  currency: string;
  decision?: "accept" | "decline";
  decidedAt?: string;
  lines: Array<{
    ruleId: string;
    name: string;
    quantity?: number;
    amountMinor: number;
    includedInTotal?: boolean;
  }>;
};

/** Read-only catalog for preparing a replacement quote. */
export type PriceCatalog = {
  currency: string;
  version: string;
  rules: Array<{
    id: string;
    group?: string;
    label: string;
    kind: "fixed" | "per_unit";
    unit?: string;
    initialRuleId?: string;
  }>;
};

/** PublicQuote from docs/PLAN.md (GET /public/quotes/:token, slice 6). */
export type PublicQuote = {
  businessName: string;
  status: "sent" | "accepted" | "declined" | "superseded" | "expired";
  currency: string;
  lines: Array<{
    name: string;
    quantity?: number;
    amountMinor: number;
    includedInTotal?: boolean;
  }>;
  assumptions: string[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  validUntil: string;
  canDecide: boolean;
  /** Customer-visible conversation. The raw quote token is never included. */
  messages: Array<{
    id: string;
    direction: "inbound" | "outbound";
    at: string;
    from: string;
    subject?: string;
    text?: string;
  }>;
};

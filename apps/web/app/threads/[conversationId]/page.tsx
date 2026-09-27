import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BosApiError,
  bosApi,
  type PriceCatalog,
  type Thread,
  type ThreadTimelineEntry,
} from "../../../lib/bos-api";
import {
  approveDraft,
  confirmQuoteDecision,
  discardDraft,
  editDraft,
  retryProcessing,
  reviseDeclinedQuote,
  sendDraft,
  sendOperatorMessage,
  takeOverConversation,
} from "./actions";

export const metadata = { title: "Conversation — BOS" };

type ThreadLoad = Thread | "login" | "not-found" | "error";

async function loadCatalog(): Promise<PriceCatalog | null> {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    return null;
  }
  try {
    return await bosApi<PriceCatalog>("/price-list", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch {
    return null;
  }
}

async function loadThread(conversationId: string): Promise<ThreadLoad> {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    return "login";
  }
  try {
    return await bosApi<Thread>(`/threads/${conversationId}`, {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      return "login";
    }
    if (error instanceof BosApiError && error.status === 404) {
      return "not-found";
    }
    return "error";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function formatMinor(currency: string, amountMinor: number): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

const QUOTE_STATUS_LABEL: Record<
  NonNullable<Thread["quote"]>["status"],
  string
> = {
  prepared: "Prepared — not sent",
  sent: "Sent — waiting for the customer",
  accepted: "Accepted",
  declined: "Declined",
};

const buttonStyle = {
  padding: "0.4rem 0.9rem",
  borderRadius: "8px",
  border: "1px solid #1a1a1a",
  background: "#1a1a1a",
  color: "#fff",
  fontSize: "0.85rem",
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#fff",
  color: "#1a1a1a",
} as const;

const dangerButtonStyle = {
  ...buttonStyle,
  background: "#fff",
  color: "#b00020",
  borderColor: "#b00020",
} as const;

function TimelineRow({ entry }: { entry: ThreadTimelineEntry }) {
  if (entry.kind === "event") {
    return (
      <li
        style={{
          alignSelf: "center",
          maxWidth: "100%",
          padding: "0.35rem 0.75rem",
          borderRadius: "999px",
          background: "#fff8e8",
          border: "1px solid #e6d3a1",
          color: "#6b5420",
          fontSize: "0.8rem",
          textAlign: "center",
        }}
      >
        <strong>Event</strong> · {entry.label}
        {entry.actor ? ` · ${entry.actor}` : ""} · {formatTime(entry.at)}
      </li>
    );
  }
  const received = entry.kind === "received";
  return (
    <li
      style={{
        alignSelf: received ? "flex-start" : "flex-end",
        width: "min(100%, 34rem)",
        border: `1px solid ${received ? "#cfe3d4" : "#d7d7d7"}`,
        borderRadius: "8px",
        padding: "0.75rem",
        background: received ? "#f3faf4" : "#f5f5f5",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          fontSize: "0.8rem",
          color: "#555",
        }}
      >
        <span>
          <strong>{received ? "Received" : "Sent"}</strong> · {entry.from}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>{formatTime(entry.at)}</span>
      </div>
      {entry.subject ? (
        <div style={{ margin: "0.5rem 0 0.25rem", fontWeight: 600 }}>
          {entry.subject}
        </div>
      ) : null}
      <p
        style={{
          margin: "0.35rem 0 0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {entry.text || "(no text body)"}
      </p>
    </li>
  );
}

function catalogGroups(catalog: PriceCatalog): Array<{
  name: string;
  rules: PriceCatalog["rules"];
}> {
  const names: string[] = [];
  for (const rule of catalog.rules) {
    const name = rule.group ?? "Other";
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names.map((name) => ({
    name,
    rules: catalog.rules.filter((rule) => (rule.group ?? "Other") === name),
  }));
}

function isExpandedFirstVisit(
  ruleId: string,
  lines: NonNullable<Thread["quote"]>["lines"],
  rules: PriceCatalog["rules"],
): boolean {
  return rules.some(
    (other) =>
      other.initialRuleId === ruleId &&
      lines.some(
        (line) => line.ruleId === other.id && line.includedInTotal === false,
      ),
  );
}

function ReviseQuote({
  conversationId,
  catalog,
  previous,
  prepared,
}: {
  conversationId: string;
  catalog: PriceCatalog;
  previous: Thread["quote"];
  prepared: boolean;
}) {
  return (
    <section
      style={{
        margin: "0.75rem 0 0",
        padding: "0.75rem",
        border: "1px solid #1a1a1a",
        borderRadius: "8px",
        background: "#fff",
        fontSize: "0.85rem",
      }}
    >
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.35rem" }}>
        {prepared ? "Review line items" : "Update quote"}
      </h2>
      <p style={{ margin: "0 0 0.75rem", color: "#555" }}>
        {prepared
          ? "Change the items and quantities. The email is rewritten from these lines. Amounts cannot be typed in."
          : "Prepares a new draft from the price list. The declined quote stays declined. Approve and send the draft to issue a new link. Prices cannot be typed in — only the items and quantities."}
      </p>
      <form action={reviseDeclinedQuote}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <div>
          {catalogGroups(catalog).map((group) => (
            <section key={group.name} style={{ margin: "0.6rem 0" }}>
              <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.25rem" }}>
                {group.name}
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {group.rules.map((rule) => {
                  const prior = previous?.lines.find(
                    (line) => line.ruleId === rule.id,
                  );
                  const checked =
                    prior !== undefined &&
                    !isExpandedFirstVisit(
                      rule.id,
                      previous?.lines ?? [],
                      catalog.rules,
                    );
                  return (
                    <li
                      key={rule.id}
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                        margin: "0.4rem 0",
                      }}
                    >
                      <label style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          type="checkbox"
                          name={`include_${rule.id}`}
                          defaultChecked={checked}
                        />
                        {rule.label}
                        {rule.unit ? ` (${rule.unit}s)` : ""}
                      </label>
                      {rule.initialRuleId ? (
                        <span style={{ color: "#555" }}>
                          First visit uses the one-time rate. Later visits are
                          not added to the total.
                        </span>
                      ) : null}
                      {rule.kind === "per_unit" ? (
                        <input
                          type="number"
                          name={`quantity_${rule.id}`}
                          min={1}
                          step={1}
                          defaultValue={prior?.quantity ?? 1}
                          aria-label={`${rule.label} quantity`}
                          style={{
                            width: "4.5rem",
                            padding: "0.25rem",
                            borderRadius: "6px",
                            border: "1px solid #e2e2e2",
                          }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <button type="submit" style={{ ...buttonStyle, marginTop: "0.75rem" }}>
          {prepared ? "Update draft from these lines" : "Prepare updated quote"}
        </button>
      </form>
    </section>
  );
}

function QuoteReply({
  conversationId,
  quoteReply,
  quote,
  openQuoteId,
}: {
  conversationId: string;
  quoteReply: NonNullable<Thread["quoteReply"]>;
  quote: Thread["quote"];
  openQuoteId: string | undefined;
}) {
  const candidate = quoteReply.candidateQuoteVersionIds[0];
  const recorded =
    quote !== undefined &&
    (quote.status === "accepted" || quote.status === "declined") &&
    (quoteReply.candidateQuoteVersionIds.length === 0 ||
      quoteReply.candidateQuoteVersionIds.includes(quote.quoteVersionId));
  const canConfirm =
    !recorded &&
    openQuoteId !== undefined &&
    quoteReply.candidateQuoteVersionIds.length === 1 &&
    candidate === openQuoteId &&
    (quoteReply.intent === "accept" || quoteReply.intent === "decline");
  return (
    <section
      style={{
        margin: "0.75rem 0 0",
        padding: "0.5rem 0.75rem",
        border: "1px solid #5b3fa8",
        borderRadius: "8px",
        background: "#f4f1fb",
        fontSize: "0.85rem",
      }}
    >
      <h2
        style={{
          fontSize: "0.9rem",
          margin: "0 0 0.35rem",
          color: "#432892",
        }}
      >
        {recorded
          ? `Quote reply recorded (${quote?.status})`
          : "Quote reply (not recorded until confirmed)"}
      </h2>
      <p style={{ margin: 0 }}>Customer intent: {quoteReply.intent}</p>
      <p style={{ margin: "0.25rem 0 0", wordBreak: "break-word" }}>
        {quoteReply.candidateQuoteVersionIds.length === 1
          ? `Candidate quote: ${candidate}`
          : `Candidates: ${quoteReply.candidateQuoteVersionIds.length}`}
      </p>
      {canConfirm ? (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginTop: "0.75rem",
          }}
        >
          <form action={confirmQuoteDecision}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="quoteVersionId" value={openQuoteId} />
            <input type="hidden" name="decision" value="accept" />
            <button type="submit" style={buttonStyle}>
              Record accept
            </button>
          </form>
          <form action={confirmQuoteDecision}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="quoteVersionId" value={openQuoteId} />
            <input type="hidden" name="decision" value="decline" />
            <button type="submit" style={dangerButtonStyle}>
              Record decline
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { conversationId } = await params;
  const { error: actionError } = await searchParams;
  const result = await loadThread(conversationId);
  const revisableThread =
    typeof result !== "string" &&
    (result.quote?.status === "declined" ||
      result.quote?.status === "prepared") &&
    result.draft?.status !== "approved"
      ? result
      : null;
  const catalog = revisableThread ? await loadCatalog() : null;
  if (result === "login") {
    redirect("/login");
  }
  return (
    <main
      style={{ maxWidth: "640px", margin: "0 auto", padding: "1.5rem 1rem" }}
    >
      <a href="/inbox" style={{ fontSize: "0.9rem" }}>
        ← Inbox
      </a>
      {result === "error" ? (
        <p style={{ color: "#b00020" }}>
          This conversation is unavailable right now. Please try again in a
          moment.
        </p>
      ) : result === "not-found" ? (
        <p style={{ color: "#555" }}>
          No conversation with that id. It may have been removed.
        </p>
      ) : (
        <>
          {actionError ? (
            <p
              style={{
                margin: "0.75rem 0 0",
                padding: "0.5rem 0.75rem",
                border: "1px solid #b00020",
                borderRadius: "8px",
                background: "#fff5f6",
                color: "#b00020",
                wordBreak: "break-word",
              }}
            >
              {actionError}
            </p>
          ) : null}
          <h1 style={{ fontSize: "1.25rem", margin: "0.75rem 0 0.25rem" }}>
            {result.conversation.subject || "(no subject)"}
          </h1>
          <div style={{ color: "#555", fontSize: "0.9rem" }}>
            {result.conversation.customer.name
              ? `${result.conversation.customer.name} · ${result.conversation.customer.address}`
              : result.conversation.customer.address}
          </div>
          {result.conversation.automationPaused ? (
            <p
              style={{
                margin: "0.5rem 0 0",
                color: "#b00020",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              Automation paused: replies are manual.
            </p>
          ) : (
            <form
              action={takeOverConversation}
              style={{ margin: "0.5rem 0 0" }}
            >
              <input
                type="hidden"
                name="conversationId"
                value={conversationId}
              />
              <button type="submit" style={secondaryButtonStyle}>
                Take over conversation
              </button>
            </form>
          )}
          {result.processing ? (
            <div
              style={{
                margin: "0.75rem 0 0",
                padding: "0.5rem 0.75rem",
                border: "1px solid #e2e2e2",
                borderRadius: "8px",
                background: "#f5f5f5",
                fontSize: "0.85rem",
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              {result.processing.lane === "complaint" ? (
                <span style={{ color: "#b00020", fontWeight: 600 }}>
                  Urgent
                </span>
              ) : null}
              <span>Lane: {result.processing.lane ?? "unknown"}</span>
              <span>Status: {result.processing.status}</span>
              {result.processing.summary ? (
                <span style={{ color: "#555" }}>
                  {result.processing.summary}
                </span>
              ) : null}
              {result.processing.status === "failed" &&
              result.messages.length > 0 ? (
                <form action={retryProcessing}>
                  <input
                    type="hidden"
                    name="conversationId"
                    value={conversationId}
                  />
                  <input
                    type="hidden"
                    name="messageId"
                    value={result.messages[result.messages.length - 1]?.id}
                  />
                  <button type="submit" style={secondaryButtonStyle}>
                    Retry processing
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
          {result.serviceNote ? (
            <section
              style={{
                margin: "0.75rem 0 0",
                padding: "0.5rem 0.75rem",
                border: "1px solid #b08900",
                borderRadius: "8px",
                background: "#fffbee",
                fontSize: "0.85rem",
              }}
            >
              <h2
                style={{
                  fontSize: "0.9rem",
                  margin: "0 0 0.35rem",
                  color: "#8a6d00",
                }}
              >
                Service note (internal — no auto-reply)
              </h2>
              <p style={{ margin: 0, wordBreak: "break-word" }}>
                Request: {result.serviceNote.request}
              </p>
              {result.serviceNote.supplied.length > 0 ? (
                <p style={{ margin: "0.25rem 0 0", color: "#555" }}>
                  Supplied: {result.serviceNote.supplied.join(", ")}
                </p>
              ) : null}
              {result.serviceNote.missing.length > 0 ? (
                <p style={{ margin: "0.25rem 0 0", color: "#555" }}>
                  Missing: {result.serviceNote.missing.join(", ")}
                </p>
              ) : null}
              <p style={{ margin: "0.25rem 0 0" }}>
                Next action: {result.serviceNote.nextAction}
              </p>
            </section>
          ) : null}
          {(result.quotes ?? []).map((quote, index, quotes) => (
            <section
              key={quote.quoteVersionId}
              style={{
                margin: "0.75rem 0 0",
                padding: "0.5rem 0.75rem",
                border: `1px solid ${
                  quote.status === "accepted"
                    ? "#2e7d32"
                    : quote.status === "declined"
                      ? "#b00020"
                      : "#1a1a1a"
                }`,
                borderRadius: "8px",
                background:
                  quote.status === "accepted"
                    ? "#f1f8f1"
                    : quote.status === "declined"
                      ? "#fff5f6"
                      : "#f7f7f7",
                fontSize: "0.85rem",
              }}
            >
              <h2 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>
                {quotes.length > 1 && index < quotes.length - 1
                  ? "Earlier quote"
                  : "Quote"}
                : {QUOTE_STATUS_LABEL[quote.status]}
              </h2>
              <p style={{ margin: 0 }}>
                Total: {formatMinor(quote.currency, quote.totalMinor)}
              </p>
              {quote.decidedAt ? (
                <p style={{ margin: "0.25rem 0 0", color: "#555" }}>
                  Decided {formatTime(quote.decidedAt)}
                  {quote.decision ? ` · ${quote.decision}` : ""}
                </p>
              ) : null}
              {quote.lines.some((line) => line.includedInTotal !== false) ? (
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {quote.lines
                    .filter((line) => line.includedInTotal !== false)
                    .map((line) => (
                      <li
                        key={`${quote.quoteVersionId}-${line.ruleId}-${line.quantity ?? 1}`}
                      >
                        {line.name}
                        {line.quantity ? ` × ${line.quantity}` : ""}:{" "}
                        {formatMinor(quote.currency, line.amountMinor)}
                      </li>
                    ))}
                </ul>
              ) : null}
              {quote.lines.some((line) => line.includedInTotal === false) ? (
                <>
                  <p style={{ margin: "0.5rem 0 0", color: "#555" }}>
                    Each following visit, not included in the total:
                  </p>
                  <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
                    {quote.lines
                      .filter((line) => line.includedInTotal === false)
                      .map((line) => (
                        <li
                          key={`${quote.quoteVersionId}-later-${line.ruleId}`}
                        >
                          {line.name}
                          {line.quantity ? ` × ${line.quantity}` : ""}:{" "}
                          {formatMinor(quote.currency, line.amountMinor)}
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </section>
          ))}
          {revisableThread && catalog ? (
            <ReviseQuote
              conversationId={conversationId}
              catalog={catalog}
              previous={revisableThread.quote}
              prepared={revisableThread.quote?.status === "prepared"}
            />
          ) : null}
          {result.quoteReply ? (
            <QuoteReply
              conversationId={conversationId}
              quoteReply={result.quoteReply}
              quote={result.quote}
              openQuoteId={result.openQuote?.quoteVersionId}
            />
          ) : null}
          {result.draft ? (
            <section
              style={{
                margin: "1rem 0 0",
                padding: "0.75rem",
                border: "1px solid #2e7d32",
                borderRadius: "8px",
                background: "#f1f8f1",
              }}
            >
              <h2
                style={{
                  fontSize: "0.95rem",
                  margin: "0 0 0.5rem",
                  color: "#2e7d32",
                }}
              >
                Draft reply ({result.draft.status})
              </h2>
              {/* Edit: the textarea holds the current body; submitting
                  creates a new proposed revision via the server action. */}
              <form action={editDraft}>
                <input
                  type="hidden"
                  name="conversationId"
                  value={conversationId}
                />
                <input
                  type="hidden"
                  name="revisionId"
                  value={result.draft.revisionId}
                />
                <textarea
                  name="bodyText"
                  defaultValue={result.draft.bodyText}
                  rows={6}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.5rem",
                    borderRadius: "8px",
                    border: "1px solid #e2e2e2",
                    fontFamily: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    marginTop: "0.5rem",
                  }}
                >
                  <button type="submit" style={buttonStyle}>
                    Save as new draft
                  </button>
                </div>
              </form>
              {result.draft.factIds?.length ? (
                <p
                  style={{
                    margin: "0.5rem 0 0",
                    fontSize: "0.8rem",
                    color: "#555",
                    wordBreak: "break-word",
                  }}
                >
                  Grounded in knowledge facts: {result.draft.factIds.join(", ")}
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginTop: "0.75rem",
                }}
              >
                {result.draft.status === "proposed" ? (
                  <form action={approveDraft}>
                    <input
                      type="hidden"
                      name="conversationId"
                      value={conversationId}
                    />
                    <input
                      type="hidden"
                      name="revisionId"
                      value={result.draft.revisionId}
                    />
                    <button type="submit" style={buttonStyle}>
                      Approve
                    </button>
                  </form>
                ) : null}
                {/* Send is enabled only when the draft is approved. */}
                {result.draft.status === "approved" ? (
                  <form action={sendDraft}>
                    <input
                      type="hidden"
                      name="conversationId"
                      value={conversationId}
                    />
                    <input
                      type="hidden"
                      name="revisionId"
                      value={result.draft.revisionId}
                    />
                    <button type="submit" style={buttonStyle}>
                      Send
                    </button>
                  </form>
                ) : null}
                <form action={discardDraft}>
                  <input
                    type="hidden"
                    name="conversationId"
                    value={conversationId}
                  />
                  <input
                    type="hidden"
                    name="revisionId"
                    value={result.draft.revisionId}
                  />
                  <button type="submit" style={dangerButtonStyle}>
                    Discard
                  </button>
                </form>
              </div>
            </section>
          ) : null}
          <h2 style={{ fontSize: "1rem", margin: "1.25rem 0 0" }}>
            Conversation
          </h2>
          <p
            style={{
              margin: "0.25rem 0 0",
              color: "#777",
              fontSize: "0.75rem",
            }}
          >
            Received, sent, and actions stay in order and look different.
          </p>
          {(result.timeline ?? []).length === 0 ? (
            <p style={{ color: "#555" }}>This conversation has no messages.</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "1rem 0 0",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {result.timeline.map((entry) => (
                <TimelineRow key={`${entry.kind}-${entry.id}`} entry={entry} />
              ))}
            </ul>
          )}
          <form action={sendOperatorMessage} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <label
              htmlFor="operator-message"
              style={{ display: "block", fontSize: "0.9rem", fontWeight: 600 }}
            >
              Send a message
            </label>
            <p
              style={{
                margin: "0.25rem 0 0.5rem",
                color: "#555",
                fontSize: "0.8rem",
              }}
            >
              Queues an email to the customer at any stage. It does not change
              the quote or replace a draft.
            </p>
            <textarea
              id="operator-message"
              name="text"
              required
              rows={4}
              placeholder="Write to the customer…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.5rem",
                borderRadius: "8px",
                border: "1px solid #e2e2e2",
                fontFamily: "inherit",
                fontSize: "0.9rem",
              }}
            />
            <button
              type="submit"
              style={{ ...buttonStyle, marginTop: "0.5rem" }}
            >
              Send message
            </button>
          </form>
        </>
      )}
    </main>
  );
}

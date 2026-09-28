import { BosApiError, bosApi, type PublicQuote } from "../../../lib/bos-api";
import { acceptQuote, declineQuote, sendCustomerMessage } from "./actions";

export const metadata = { title: "Your quote — BOS" };

type QuoteLoad = PublicQuote | "not-found" | "error";

async function loadQuote(token: string): Promise<QuoteLoad> {
  try {
    return await bosApi<PublicQuote>(`/public/quotes/${token}`);
  } catch (error) {
    if (error instanceof BosApiError && error.status === 404) {
      return "not-found";
    }
    return "error";
  }
}

function formatMinor(currency: string, amountMinor: number): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

const buttonStyle = {
  padding: "0.5rem 1rem",
  borderRadius: "8px",
  border: "1px solid #1a1a1a",
  background: "#1a1a1a",
  color: "#fff",
  fontSize: "0.9rem",
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#fff",
  color: "#1a1a1a",
} as const;

const listStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
} as const;

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const result = await loadQuote(token);

  return (
    <main
      style={{ maxWidth: "640px", margin: "0 auto", padding: "1.5rem 1rem" }}
    >
      {result === "not-found" ? (
        <section>
          <h1 style={{ fontSize: "1.2rem", margin: "0 0 0.5rem" }}>
            Quote not found
          </h1>
          <p style={{ color: "#555" }}>
            This link is unknown, expired, or no longer valid.
          </p>
        </section>
      ) : result === "error" ? (
        <p style={{ color: "#b00020" }}>
          This quote is unavailable right now. Please try again in a moment.
        </p>
      ) : (
        <section>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.25rem" }}>
            {result.businessName}
          </h1>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: 0 }}>
            Your quote
          </p>

          {error ? (
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
              {error}
            </p>
          ) : null}

          {/* Status: only sent/accepted/declined are ever displayed; an
              expired or superseded token is a 404 above. */}
          {result.status === "accepted" ? (
            <p
              style={{
                color: "#2e7d32",
                fontWeight: 600,
                margin: "0.75rem 0 0",
              }}
            >
              You accepted this quote.
            </p>
          ) : result.status === "declined" ? (
            <p
              style={{ color: "#555", fontWeight: 600, margin: "0.75rem 0 0" }}
            >
              You declined this quote.
            </p>
          ) : (
            <p style={{ color: "#555", margin: "0.75rem 0 0" }}>
              Valid until {formatDate(result.validUntil)}.
            </p>
          )}

          <ul style={{ ...listStyle, marginTop: "1rem" }}>
            {result.lines
              .filter((line) => line.includedInTotal !== false)
              .map((line) => (
                <li
                  key={`${line.name}-${line.quantity ?? 1}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    padding: "0.4rem 0",
                    borderBottom: "1px solid #eee",
                    fontSize: "0.95rem",
                  }}
                >
                  <span>
                    {line.name}
                    {line.quantity ? ` × ${line.quantity}` : ""}
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {formatMinor(result.currency, line.amountMinor)}
                  </span>
                </li>
              ))}
          </ul>
          {result.lines.some((line) => line.includedInTotal === false) ? (
            <>
              <h2 style={{ fontSize: "0.9rem", margin: "1rem 0 0" }}>
                Each following visit
              </h2>
              <p
                style={{
                  color: "#555",
                  margin: "0.25rem 0 0",
                  fontSize: "0.85rem",
                }}
              >
                Not included in the total.
              </p>
              <ul style={{ ...listStyle, marginTop: "0.35rem" }}>
                {result.lines
                  .filter((line) => line.includedInTotal === false)
                  .map((line) => (
                    <li
                      key={`later-${line.name}-${line.quantity ?? 1}`}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        padding: "0.4rem 0",
                        borderBottom: "1px solid #eee",
                        fontSize: "0.95rem",
                      }}
                    >
                      <span>
                        {line.name}
                        {line.quantity ? ` × ${line.quantity}` : ""}
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {formatMinor(result.currency, line.amountMinor)}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          {result.assumptions.length > 0 ? (
            <div style={{ marginTop: "0.75rem" }}>
              <h2 style={{ fontSize: "0.9rem", margin: "0 0 0.25rem" }}>
                Assumptions
              </h2>
              <ul style={{ ...listStyle, color: "#555", fontSize: "0.85rem" }}>
                {result.assumptions.map((assumption) => (
                  <li key={assumption} style={{ margin: "0.2rem 0" }}>
                    {assumption}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <dl
            style={{
              margin: "1rem 0 0",
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt style={{ color: "#555" }}>Subtotal</dt>
              <dd style={{ margin: 0 }}>
                {formatMinor(result.currency, result.subtotalMinor)}
              </dd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt style={{ color: "#555" }}>Tax</dt>
              <dd style={{ margin: 0 }}>
                {formatMinor(result.currency, result.taxMinor)}
              </dd>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 600,
                borderTop: "1px solid #1a1a1a",
                marginTop: "0.25rem",
                paddingTop: "0.25rem",
              }}
            >
              <dt>Total</dt>
              <dd style={{ margin: 0 }}>
                {formatMinor(result.currency, result.totalMinor)}
              </dd>
            </div>
          </dl>

          {/* Explicit form buttons — not links — so deciding requires an
              intentional POST. Read-only once decided or expired. */}
          {result.canDecide ? (
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                marginTop: "1.25rem",
              }}
            >
              <form action={acceptQuote}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" style={buttonStyle}>
                  Accept quote
                </button>
              </form>
              <form action={declineQuote}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" style={secondaryButtonStyle}>
                  Decline quote
                </button>
              </form>
            </div>
          ) : (
            <p
              style={{
                marginTop: "1.25rem",
                color: "#777",
                fontSize: "0.85rem",
              }}
            >
              This quote can no longer be decided from this link. You can still
              send a message.
            </p>
          )}

          <h2
            id="conversation"
            style={{ fontSize: "1rem", margin: "1.5rem 0 0.5rem" }}
          >
            Conversation ({result.messages.length})
          </h2>
          <p
            style={{ margin: "0 0 0.75rem", color: "#555", fontSize: "0.8rem" }}
          >
            The whole thread with the business, oldest first.
          </p>
          {result.messages.length === 0 ? (
            <p style={{ color: "#555" }}>No messages yet.</p>
          ) : (
            <ul
              style={{
                ...listStyle,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {result.messages.map((message) => {
                const received = message.direction === "inbound";
                return (
                  <li
                    key={message.id}
                    style={{
                      alignSelf: received ? "flex-end" : "flex-start",
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
                        <strong>{received ? "You" : "Business"}</strong> ·{" "}
                        {message.from}
                      </span>
                      <span style={{ whiteSpace: "nowrap" }}>
                        {formatDate(message.at)}
                      </span>
                    </div>
                    {message.subject ? (
                      <div style={{ margin: "0.45rem 0 0", fontWeight: 600 }}>
                        {message.subject}
                      </div>
                    ) : null}
                    <p
                      style={{
                        margin: "0.5rem 0 0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {message.text || "(no text body)"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <form action={sendCustomerMessage} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="token" value={token} />
            <label
              htmlFor="customer-message"
              style={{
                display: "block",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              Send a message as the customer
            </label>
            <p
              style={{
                margin: "0.25rem 0 0.5rem",
                color: "#555",
                fontSize: "0.8rem",
              }}
            >
              Adds your reply to this thread. You can write before or after you
              accept or decline.
            </p>
            <textarea
              id="customer-message"
              name="text"
              required
              rows={4}
              placeholder="Write to the business…"
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
        </section>
      )}
    </main>
  );
}

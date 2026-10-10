import { Icon } from "../../../components/icon";
import { SubmitButton } from "../../../components/submit-button";
import { Badge, Brand, EmptyState } from "../../../components/ui";
import { BosApiError, bosApi, type PublicQuote } from "../../../lib/bos-api";
import { formatMoney, formatTime } from "../../../lib/presentation";
import { acceptQuote, declineQuote, sendCustomerMessage } from "./actions";

export const metadata = { title: "Your quote — OwnStack" };

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  let result: PublicQuote | undefined;
  let notFound = false;
  try {
    result = await bosApi<PublicQuote>(`/public/quotes/${token}`);
  } catch (error) {
    notFound = error instanceof BosApiError && error.status === 404;
  }
  return (
    <main className="public-page">
      <header className="public-header">
        <Brand />
        <span className="small muted">Your customer portal</span>
      </header>
      {!result ? (
        <div className="panel">
          <EmptyState
            icon={notFound ? "quote" : "alert"}
            title={
              notFound
                ? "This quote isn’t available"
                : "We couldn’t load your quote"
            }
            description={
              notFound
                ? "The link may have expired or been replaced. Please contact the business for an updated quote."
                : "Please try again in a moment."
            }
          />
        </div>
      ) : (
        <>
          <div className="public-title">
            <p className="eyebrow">PREPARED FOR YOU</p>
            <h1>{result.businessName}</h1>
            <p>Your quote, with every detail in one place.</p>
          </div>
          {error ? (
            <div className="notice notice-red" role="alert">
              {error}
            </div>
          ) : null}
          <section className="panel public-quote">
            <div className="panel-heading">
              <div className="section-title">
                <Icon name="quote" />
                <h2>Your quote</h2>
              </div>
              <Badge
                tone={
                  result.status === "accepted"
                    ? "green"
                    : result.status === "declined"
                      ? "neutral"
                      : "amber"
                }
              >
                {result.status === "sent"
                  ? "Awaiting your decision"
                  : result.status}
              </Badge>
            </div>
            <div className="panel-body stack-lg">
              <p className="muted">
                {result.status === "accepted"
                  ? "Thank you. You’ve accepted this quote."
                  : result.status === "declined"
                    ? "You’ve declined this quote. You can still send us a message below."
                    : `Valid until ${formatTime(result.validUntil)} (Sydney time).`}
              </p>
              <ul className="price-lines">
                {result.lines
                  .filter((line) => line.includedInTotal !== false)
                  .map((line) => (
                    <li key={`${line.name}-${line.quantity ?? 1}`}>
                      <span>
                        {line.name}
                        {line.quantity ? ` × ${line.quantity}` : ""}
                      </span>
                      <strong>
                        {formatMoney(result.currency, line.amountMinor)}
                      </strong>
                    </li>
                  ))}
              </ul>
              {result.lines.some((line) => line.includedInTotal === false) ? (
                <div className="recurring-lines">
                  <h3>Each following visit</h3>
                  <p className="small muted">
                    Not included in the total below.
                  </p>
                  <ul className="price-lines">
                    {result.lines
                      .filter((line) => line.includedInTotal === false)
                      .map((line) => (
                        <li key={`${line.name}-${line.quantity ?? 1}`}>
                          <span>
                            {line.name}
                            {line.quantity ? ` × ${line.quantity}` : ""}
                          </span>
                          <strong>
                            {formatMoney(result.currency, line.amountMinor)}
                          </strong>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              {result.assumptions.length ? (
                <div className="notice notice-amber">
                  <strong>Good to know</strong>
                  <ul>
                    {result.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <dl className="quote-totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatMoney(result.currency, result.subtotalMinor)}</dd>
                </div>
                <div>
                  <dt>Tax</dt>
                  <dd>{formatMoney(result.currency, result.taxMinor)}</dd>
                </div>
                <div className="quote-total">
                  <dt>Total</dt>
                  <dd>{formatMoney(result.currency, result.totalMinor)}</dd>
                </div>
              </dl>
              {result.canDecide ? (
                <div className="actions-row">
                  <form action={acceptQuote}>
                    <input type="hidden" name="token" value={token} />
                    <SubmitButton
                      pendingLabel="Accepting…"
                      confirmMessage="Accept this quote?"
                    >
                      <Icon name="check" size={16} />
                      Accept quote
                    </SubmitButton>
                  </form>
                  <form action={declineQuote}>
                    <input type="hidden" name="token" value={token} />
                    <SubmitButton
                      variant="secondary"
                      pendingLabel="Recording…"
                      confirmMessage="Decline this quote?"
                    >
                      Decline quote
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <p className="small muted">
                  This quote is read-only. You can still send a message below.
                </p>
              )}
            </div>
          </section>
          <section className="panel" id="conversation">
            <div className="panel-heading">
              <div className="section-title">
                <Icon name="mail" />
                <h2>Your conversation</h2>
              </div>
              <Badge>{result.messages.length} messages</Badge>
            </div>
            {result.messages.length ? (
              <ul className="timeline">
                {result.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`timeline-message ${message.direction === "inbound" ? "message-sent" : "message-received"}`}
                  >
                    <div className="message-meta">
                      <strong>
                        {message.direction === "inbound"
                          ? "You"
                          : result.businessName}
                      </strong>
                      <time dateTime={message.at}>
                        {formatTime(message.at)}
                      </time>
                    </div>
                    {message.subject ? <h3>{message.subject}</h3> : null}
                    <p className="message-text">
                      {message.text || "No text body."}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-body muted">
                No messages yet. Ask a question below.
              </p>
            )}
            <form
              action={sendCustomerMessage}
              className="panel-body stack public-message-form"
            >
              <input type="hidden" name="token" value={token} />
              <label htmlFor="customer-message">
                Have a question? Send a message.
              </label>
              <p className="small muted">
                Your reply stays in this conversation, before or after your
                decision.
              </p>
              <textarea
                id="customer-message"
                name="text"
                required
                rows={4}
                placeholder="Write to the team…"
              />
              <SubmitButton pendingLabel="Sending…">
                <Icon name="send" size={16} />
                Send message
              </SubmitButton>
            </form>
          </section>
        </>
      )}
      <footer className="public-footer">
        <Icon name="shield" size={15} />
        Powered by OwnStack · Clear quotes. Real conversations.
      </footer>
    </main>
  );
}

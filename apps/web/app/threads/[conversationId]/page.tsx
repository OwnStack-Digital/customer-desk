import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "../../../components/icon";
import { SubmitButton } from "../../../components/submit-button";
import { Avatar, Badge, EmptyState } from "../../../components/ui";
import { Workspace } from "../../../components/workspace";
import {
  BosApiError,
  bosApi,
  type PriceCatalog,
  type Thread,
  type ThreadQuote,
  type ThreadTimelineEntry,
} from "../../../lib/bos-api";
import {
  formatMoney,
  formatTime,
  laneLabels,
  processingLabels,
  processingTone,
} from "../../../lib/presentation";
import {
  confirmQuoteDecision,
  instructAssistant,
  receiveCustomerReply,
  retryProcessing,
  reviseDeclinedQuote,
  sendOperatorMessage,
  takeOverConversation,
} from "./actions";
import { DraftPanel } from "./draft-panel";

export const metadata = { title: "Conversation — OwnStack" };

function ConversationId({ id }: { id: string }) {
  return <input type="hidden" name="conversationId" value={id} />;
}

function TimelineRow({ entry }: { entry: ThreadTimelineEntry }) {
  if (entry.kind === "event")
    return (
      <li className="timeline-event">
        <Icon name="check" size={14} />
        <span>
          {entry.label}
          {entry.actor ? ` · ${entry.actor}` : ""}
          <time dateTime={entry.at}>{formatTime(entry.at)}</time>
        </span>
      </li>
    );
  const label =
    entry.kind === "instruction"
      ? "Assistant instruction"
      : entry.kind === "received"
        ? "Customer"
        : "Outgoing message";
  return (
    <li className={`timeline-message message-${entry.kind}`}>
      <div className="message-meta">
        <div className="message-author">
          <Avatar name={entry.from} />
          <span>
            <strong>{label}</strong>
            <small>{entry.from}</small>
          </span>
        </div>
        <time dateTime={entry.at}>{formatTime(entry.at)}</time>
      </div>
      {entry.subject ? <h3>{entry.subject}</h3> : null}
      <p className="message-text">{entry.text || "No text body."}</p>
    </li>
  );
}

function QuoteCard({
  quote,
  earlier,
}: {
  quote: ThreadQuote;
  earlier: boolean;
}) {
  const labels = {
    prepared: "Prepared · not sent",
    sent: "Awaiting customer",
    accepted: "Accepted",
    declined: "Declined",
  };
  const laterLines = quote.lines.filter(
    (line) => line.includedInTotal === false,
  );
  return (
    <section className="panel quote-card">
      <div className="panel-heading">
        <div className="section-title">
          <Icon name="quote" />
          <h2>{earlier ? "Earlier quote" : "Quote summary"}</h2>
        </div>
        <Badge
          tone={
            quote.status === "accepted"
              ? "green"
              : quote.status === "declined"
                ? "red"
                : "neutral"
          }
        >
          {labels[quote.status]}
        </Badge>
      </div>
      <div className="panel-body stack">
        <ul className="price-lines">
          {quote.lines
            .filter((line) => line.includedInTotal !== false)
            .map((line) => (
              <li key={`${line.ruleId}-${line.quantity ?? 1}`}>
                <span>
                  {line.name}
                  {line.quantity ? <small> × {line.quantity}</small> : null}
                </span>
                <strong>{formatMoney(quote.currency, line.amountMinor)}</strong>
              </li>
            ))}
        </ul>
        <div className="quote-total">
          <span>Total</span>
          <strong>{formatMoney(quote.currency, quote.totalMinor)}</strong>
        </div>
        {laterLines.length ? (
          <div className="recurring-lines">
            <p className="small muted">
              Each following visit · not included above
            </p>
            <ul className="price-lines">
              {laterLines.map((line) => (
                <li key={`${line.ruleId}-${line.quantity ?? 1}`}>
                  <span>
                    {line.name}
                    {line.quantity ? ` × ${line.quantity}` : ""}
                  </span>
                  <strong>
                    {formatMoney(quote.currency, line.amountMinor)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {quote.decidedAt ? (
          <p className="small muted">
            Decision recorded {formatTime(quote.decidedAt)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ReviseQuote({
  conversationId,
  catalog,
  previous,
}: {
  conversationId: string;
  catalog: PriceCatalog;
  previous: ThreadQuote;
}) {
  const groups = [
    ...new Set(catalog.rules.map((rule) => rule.group ?? "Other")),
  ];
  return (
    <details className="panel disclosure">
      <summary>
        <span>
          <Icon name="quote" size={18} />
          {previous.status === "prepared"
            ? "Edit quote line items"
            : "Prepare a revised quote"}
        </span>
        <span className="disclosure-hint">Expand</span>
      </summary>
      <div className="panel-body stack">
        <p className="small muted">
          Choose services and quantities. Prices come from your price list.
          Updating creates a new draft for approval; earlier decisions stay
          unchanged.
        </p>
        <form action={reviseDeclinedQuote} className="stack">
          <ConversationId id={conversationId} />
          {groups.map((group) => (
            <fieldset key={group} className="catalog-group">
              <legend>{group}</legend>
              {catalog.rules
                .filter((rule) => (rule.group ?? "Other") === group)
                .map((rule) => {
                  const prior = previous.lines.find(
                    (line) => line.ruleId === rule.id,
                  );
                  const expanded = catalog.rules.some(
                    (other) =>
                      other.initialRuleId === rule.id &&
                      previous.lines.some(
                        (line) =>
                          line.ruleId === other.id &&
                          line.includedInTotal === false,
                      ),
                  );
                  return (
                    <div className="catalog-row" key={rule.id}>
                      <label>
                        <input
                          type="checkbox"
                          name={`include_${rule.id}`}
                          defaultChecked={prior !== undefined && !expanded}
                        />
                        <span>
                          {rule.label}
                          {rule.unit ? ` (per ${rule.unit})` : ""}
                          {rule.initialRuleId ? (
                            <small>
                              First visit uses the one-time rate; later visits
                              are separate.
                            </small>
                          ) : null}
                        </span>
                      </label>
                      {rule.kind === "per_unit" ? (
                        <input
                          type="number"
                          name={`quantity_${rule.id}`}
                          min={1}
                          step={1}
                          defaultValue={prior?.quantity ?? 1}
                          aria-label={`${rule.label} quantity${rule.unit ? ` in ${rule.unit}s` : ""}`}
                        />
                      ) : null}
                    </div>
                  );
                })}
            </fieldset>
          ))}
          <SubmitButton pendingLabel="Preparing quote…">
            Update quote draft
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

function QuoteReply({
  conversationId,
  thread,
}: {
  conversationId: string;
  thread: Thread;
}) {
  const reply = thread.quoteReply;
  if (!reply) return null;
  const recorded =
    thread.quote &&
    (thread.quote.status === "accepted" ||
      thread.quote.status === "declined") &&
    (reply.candidateQuoteVersionIds.length === 0 ||
      reply.candidateQuoteVersionIds.includes(thread.quote.quoteVersionId));
  const canConfirm =
    !recorded &&
    thread.openQuote &&
    reply.candidateQuoteVersionIds.length === 1 &&
    reply.candidateQuoteVersionIds[0] === thread.openQuote.quoteVersionId &&
    (reply.intent === "accept" || reply.intent === "decline");
  return (
    <section className="notice notice-amber stack">
      <h2>
        {recorded
          ? `Quote reply recorded: ${thread.quote?.status}`
          : "Confirm the customer’s decision"}
      </h2>
      <p>
        Customer intent: {reply.intent}.{" "}
        {recorded
          ? "The decision has been saved."
          : "No decision is recorded until you confirm it."}
      </p>
      {canConfirm ? (
        <div className="actions-row">
          {(["accept", "decline"] as const).map((decision) => (
            <form action={confirmQuoteDecision} key={decision}>
              <ConversationId id={conversationId} />
              <input
                type="hidden"
                name="quoteVersionId"
                value={thread.openQuote?.quoteVersionId}
              />
              <input type="hidden" name="decision" value={decision} />
              <SubmitButton
                variant={decision === "accept" ? "primary" : "danger"}
                confirmMessage={`Record the customer’s ${decision === "accept" ? "acceptance" : "decline"} of this quote?`}
              >
                Record {decision}
              </SubmitButton>
            </form>
          ))}
        </div>
      ) : !recorded ? (
        <p className="small">
          Review the conversation to identify the quote and the customer’s
          decision.
        </p>
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
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) redirect("/login");
  let result: Thread | undefined;
  let notFound = false;
  try {
    result = await bosApi<Thread>(`/threads/${conversationId}`, {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401)
      redirect("/login");
    notFound = error instanceof BosApiError && error.status === 404;
  }
  if (!result)
    return (
      <Workspace section="Conversation">
        <div className="panel">
          <EmptyState
            icon={notFound ? "search" : "alert"}
            title={
              notFound
                ? "Conversation not found"
                : "Unable to load this conversation"
            }
            description={
              notFound
                ? "This conversation may have been removed."
                : "Please try again in a moment."
            }
          >
            <Link className="button button-secondary" href="/inbox">
              Back to inbox
            </Link>
          </EmptyState>
        </div>
      </Workspace>
    );
  let catalog: PriceCatalog | undefined;
  if (
    (result.quote?.status === "prepared" ||
      result.quote?.status === "declined") &&
    result.draft?.status !== "approved"
  ) {
    try {
      catalog = await bosApi<PriceCatalog>("/price-list", {
        headers: { cookie: `bos_session=${session}` },
      });
    } catch {
      /* The conversation remains usable if the catalog is unavailable. */
    }
  }
  const customer = result.conversation.customer;
  return (
    <Workspace section="Conversation">
      <Link href="/inbox" className="back-link">
        <Icon name="back" size={16} />
        Back to inbox
      </Link>
      {actionError ? (
        <div className="notice notice-red" role="alert">
          {actionError}
        </div>
      ) : null}
      <div className="thread-heading">
        <div>
          <p className="eyebrow">CUSTOMER CONVERSATION</p>
          <h1>{result.conversation.subject || "No subject"}</h1>
          <div className="customer-line">
            <Avatar name={customer.name || customer.address} />
            <span>
              <strong>{customer.name || "Customer"}</strong>
              <span>{customer.address}</span>
            </span>
          </div>
        </div>
        <a href="#draft" className="button button-secondary">
          Review & reply
          <Icon name="arrow" size={16} />
        </a>
      </div>
      <div className="thread-grid">
        <div className="thread-main stack-lg">
          {result.processing ? (
            <div
              className={`processing-summary ${result.processing.status === "needs_human" || result.processing.lane === "complaint" ? "needs-attention" : ""}`}
            >
              <span className="summary-icon">
                <Icon
                  name={
                    result.processing.lane === "complaint" ? "alert" : "spark"
                  }
                />
              </span>
              <div>
                <div className="actions-row">
                  <strong>
                    {result.processing.lane
                      ? laneLabels[result.processing.lane]
                      : "Message processing"}
                  </strong>
                  <Badge tone={processingTone(result.processing.status)}>
                    {processingLabels[result.processing.status]}
                  </Badge>
                  {result.processing.lane === "complaint" ? (
                    <Badge tone="red">Urgent</Badge>
                  ) : null}
                </div>
                <p>
                  {result.processing.summary ||
                    "Processing details will appear here."}
                </p>
                {result.processing.status === "failed" &&
                result.messages.length > 0 ? (
                  <form action={retryProcessing}>
                    <ConversationId id={conversationId} />
                    <input
                      type="hidden"
                      name="messageId"
                      value={result.messages[result.messages.length - 1]?.id}
                    />
                    <SubmitButton variant="secondary" pendingLabel="Retrying…">
                      Retry processing
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          ) : null}
          <section className="panel conversation-panel" id="conversation">
            <div className="panel-heading">
              <div className="section-title">
                <Icon name="mail" />
                <h2>Conversation</h2>
              </div>
              <span className="small muted">Oldest first · Sydney time</span>
            </div>
            {result.timeline.length ? (
              <ul className="timeline">
                {result.timeline.map((entry) => (
                  <TimelineRow
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No messages yet"
                description="Messages and activity will appear here."
              />
            )}
          </section>
          {result.serviceNote ? (
            <section className="notice notice-amber stack">
              <h2>Internal service note</h2>
              <p>{result.serviceNote.request}</p>
              {result.serviceNote.supplied.length ? (
                <p>
                  <strong>Provided:</strong>{" "}
                  {result.serviceNote.supplied.join(", ")}
                </p>
              ) : null}
              {result.serviceNote.missing.length ? (
                <p>
                  <strong>Still needed:</strong>{" "}
                  {result.serviceNote.missing.join(", ")}
                </p>
              ) : null}
              <p>
                <strong>Next step:</strong> {result.serviceNote.nextAction}
              </p>
              <small>Internal only. No automatic reply.</small>
            </section>
          ) : null}
          <section className="panel">
            <div className="panel-heading">
              <div className="section-title">
                <Icon name="spark" />
                <h2>Ask the assistant</h2>
              </div>
              <Badge>Internal only</Badge>
            </div>
            <form action={instructAssistant} className="panel-body stack">
              <ConversationId id={conversationId} />
              <p className="small muted">
                Give instructions using the conversation as context. This may
                replace the current draft, but never emails the customer.
              </p>
              <label htmlFor="assistant-instruction" className="sr-only">
                Instructions for the assistant
              </label>
              <textarea
                id="assistant-instruction"
                name="text"
                required
                rows={3}
                placeholder="e.g. Make the reply warmer and ask which day suits them."
              />
              <SubmitButton pendingLabel="Updating draft…">
                <Icon name="spark" size={16} />
                Update draft
              </SubmitButton>
            </form>
          </section>
          <details className="panel disclosure">
            <summary>
              <span>
                <Icon name="send" size={18} />
                Write a manual reply
              </span>
              <span className="disclosure-hint">Expand</span>
            </summary>
            <form action={sendOperatorMessage} className="panel-body stack">
              <ConversationId id={conversationId} />
              <p className="small muted">
                Queues a message to the customer without changing the quote or
                suggested draft. Messages are recorded in the demo outbox, not
                delivered.
              </p>
              <label htmlFor="operator-message">Your reply</label>
              <textarea
                id="operator-message"
                name="text"
                required
                rows={5}
                placeholder="Write to the customer…"
              />
              <SubmitButton
                pendingLabel="Queuing…"
                confirmMessage="Queue this manual reply to the customer?"
              >
                <Icon name="send" size={16} />
                Send to outbox
              </SubmitButton>
            </form>
          </details>
          <details className="panel disclosure demo-disclosure">
            <summary>
              <span>Simulate a customer reply</span>
              <Badge>Demo tool</Badge>
            </summary>
            <form action={receiveCustomerReply} className="panel-body stack">
              <ConversationId id={conversationId} />
              <p className="small muted">
                Adds a reply from {customer.address} and processes it with the
                thread. No email is sent. The current draft may change.
              </p>
              <label htmlFor="customer-reply">Customer message</label>
              <textarea
                id="customer-reply"
                name="text"
                required
                rows={4}
                placeholder="Write as the customer…"
              />
              <SubmitButton
                variant="secondary"
                pendingLabel="Processing reply…"
              >
                Add customer reply
              </SubmitButton>
            </form>
          </details>
        </div>
        <aside className="thread-aside stack-lg" aria-label="Review and reply">
          {result.draft ? (
            <DraftPanel
              key={result.draft.revisionId}
              draft={result.draft}
              conversationId={conversationId}
            />
          ) : (
            <section className="panel" id="draft">
              <EmptyState
                icon="mail"
                title="No draft to review"
                description="Ask the assistant to prepare a reply, or write a manual message."
              />
            </section>
          )}
          <QuoteReply conversationId={conversationId} thread={result} />
          {(result.quotes ?? []).map((quote, index, quotes) => (
            <QuoteCard
              key={quote.quoteVersionId}
              quote={quote}
              earlier={index < quotes.length - 1}
            />
          ))}
          {catalog && result.quote ? (
            <ReviseQuote
              conversationId={conversationId}
              catalog={catalog}
              previous={result.quote}
            />
          ) : null}
          <section className="panel" id="conversation-control">
            <div className="panel-body stack">
              <div className="section-title">
                <Icon name="shield" />
                <h2>Conversation control</h2>
              </div>
              {result.conversation.automationPaused ? (
                <>
                  <Badge tone="amber">Automation paused</Badge>
                  <p className="small muted">
                    You’ve taken over. Replies are handled manually.
                  </p>
                </>
              ) : (
                <>
                  <p className="small muted">
                    Need a personal touch? Take over to pause automation for
                    this conversation.
                  </p>
                  <form action={takeOverConversation}>
                    <ConversationId id={conversationId} />
                    <SubmitButton
                      variant="secondary"
                      confirmMessage="Pause automation and take over this conversation?"
                      pendingLabel="Taking over…"
                    >
                      Take over conversation
                    </SubmitButton>
                  </form>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>
    </Workspace>
  );
}

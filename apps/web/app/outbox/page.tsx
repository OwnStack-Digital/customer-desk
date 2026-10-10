import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "../../components/icon";
import { RefreshButton } from "../../components/refresh-button";
import { Avatar, Badge, EmptyState } from "../../components/ui";
import { Workspace } from "../../components/workspace";
import {
  BosApiError,
  bosApi,
  type OutboxPage as OutboxData,
} from "../../lib/bos-api";
import { formatTime } from "../../lib/presentation";

export const metadata = { title: "Outbox — OwnStack" };

export default async function OutboxPage() {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) redirect("/login");
  let result: OutboxData | undefined;
  try {
    result = await bosApi<OutboxData>("/outbox", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401)
      redirect("/login");
  }
  return (
    <Workspace active="outbox" section="Outbox">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OUTGOING CONVERSATIONS</p>
          <h1>
            Outbox<span className="heading-dot">.</span>
          </h1>
          <p>A clear record of the replies you’ve approved and queued.</p>
        </div>
        <RefreshButton />
      </div>
      <div className="notice notice-green outbox-notice">
        <Icon name="shield" />
        <div>
          <strong>You’re in demo mode</strong>
          <p>
            Messages are recorded here, not delivered to customers. You can
            safely explore the review and send workflow.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">
            <Icon name="send" />
            <h2>Outgoing messages</h2>
          </div>
          {result ? <Badge>{result.items.length} total</Badge> : null}
        </div>
        {!result ? (
          <EmptyState
            icon="alert"
            title="We couldn’t load the outbox"
            description="Please refresh the page in a moment."
          />
        ) : !result.items.length ? (
          <EmptyState
            icon="send"
            title="Nothing queued just yet"
            description="Review a draft in your inbox, approve it, then send it. Your outgoing message will appear here."
          >
            <Link href="/inbox" className="button button-primary">
              Go to inbox
              <Icon name="arrow" size={16} />
            </Link>
          </EmptyState>
        ) : (
          <ul className="outbox-list">
            {result.items.map((item) => (
              <li key={item.messageId}>
                <Avatar name={item.recipient} />
                <div className="outbox-item-body">
                  <div className="row-heading">
                    <Link href={`/threads/${item.conversationId}`}>
                      {item.recipient}
                    </Link>
                    <time dateTime={item.createdAt}>
                      {formatTime(item.createdAt)}
                    </time>
                  </div>
                  <div className="row-tags">
                    <Badge
                      tone={
                        item.status === "failed" || item.status === "uncertain"
                          ? "red"
                          : item.status === "sent"
                            ? "green"
                            : "amber"
                      }
                    >
                      {item.status}
                    </Badge>
                    <span className="small muted">
                      {item.attempts} delivery attempt
                      {item.attempts === 1 ? "" : "s"}
                    </span>
                  </div>
                  {item.lastError ? (
                    <p className="error-text small">{item.lastError}</p>
                  ) : (
                    <p className="small muted">No delivery errors recorded.</p>
                  )}
                </div>
                <Link
                  className="icon-button"
                  href={`/threads/${item.conversationId}`}
                  aria-label={`Open conversation with ${item.recipient}`}
                >
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Workspace>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BosApiError,
  bosApi,
  type OutboxItem,
  type OutboxPage as OutboxPageData,
} from "../../lib/bos-api";

export const metadata = { title: "Outbox — BOS" };

type OutboxLoad = OutboxPageData | "login" | "error";

async function loadOutbox(): Promise<OutboxLoad> {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    return "login";
  }
  try {
    return await bosApi<OutboxPageData>("/outbox", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      return "login";
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

function OutboxRow({ item }: { item: OutboxItem }) {
  return (
    <li
      style={{
        border: "1px solid #e2e2e2",
        borderRadius: "8px",
        padding: "0.75rem",
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <a
          href={`/threads/${item.conversationId}`}
          style={{ color: "#1a1a1a", fontWeight: 600 }}
        >
          {item.recipient}
        </a>
        <span
          style={{ color: "#555", fontSize: "0.8rem", whiteSpace: "nowrap" }}
        >
          {formatTime(item.createdAt)}
        </span>
      </div>
      <div
        style={{
          marginTop: "0.25rem",
          fontSize: "0.75rem",
          color: "#777",
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span>Status: {item.status}</span>
        <span>Attempts: {item.attempts}</span>
      </div>
      {/* Last error column: empty in the happy path. */}
      {item.lastError ? (
        <p
          style={{
            margin: "0.5rem 0 0",
            color: "#b00020",
            fontSize: "0.85rem",
            wordBreak: "break-word",
          }}
        >
          Last error: {item.lastError}
        </p>
      ) : (
        <p style={{ margin: "0.5rem 0 0", color: "#777", fontSize: "0.75rem" }}>
          No errors
        </p>
      )}
    </li>
  );
}

export default async function OutboxPage() {
  const result = await loadOutbox();
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
      <h1 style={{ fontSize: "1.25rem", margin: "0.75rem 0 0" }}>Outbox</h1>
      <p style={{ color: "#555", fontSize: "0.85rem" }}>
        Queued replies. Nothing has been delivered yet — the demonstrator
        records what is ready to send.
      </p>
      {result === "error" ? (
        <p style={{ color: "#b00020" }}>
          The outbox is unavailable right now. Please try again in a moment.
        </p>
      ) : result.items.length === 0 ? (
        <p style={{ color: "#555" }}>
          No queued replies. Approve and send a draft to see it here.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0.75rem 0 0",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {result.items.map((item) => (
            <OutboxRow key={item.messageId} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}

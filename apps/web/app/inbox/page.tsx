import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BosApiError,
  bosApi,
  type InboxItem,
  type InboxPage as InboxPageData,
} from "../../lib/bos-api";

export const metadata = { title: "Inbox — BOS" };

const pageStyle = {
  maxWidth: "640px",
  margin: "0 auto",
  padding: "1.5rem 1rem",
} as const;

async function loadInbox(): Promise<InboxPageData | "login" | "error"> {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    return "login";
  }
  try {
    return await bosApi<InboxPageData>("/inbox", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      // Expired or revoked session: ask the operator to sign in again.
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

function InboxRow({ item }: { item: InboxItem }) {
  const customer = item.from.name
    ? `${item.from.name} · ${item.from.address}`
    : item.from.address;
  return (
    <li>
      <a
        href={`/threads/${item.conversationId}`}
        style={{
          display: "block",
          padding: "0.75rem",
          border: "1px solid #e2e2e2",
          borderRadius: "8px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.5rem",
          }}
        >
          <strong
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {customer}
          </strong>
          <span
            style={{ color: "#555", whiteSpace: "nowrap", fontSize: "0.8rem" }}
          >
            {formatTime(item.latestAt)}
          </span>
        </div>
        {item.subject ? (
          <div style={{ margin: "0.25rem 0" }}>{item.subject}</div>
        ) : null}
        <p
          style={{
            margin: 0,
            color: "#555",
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.preview || "(no preview)"}
        </p>
        <div
          style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#777" }}
        >
          {item.processing}
        </div>
      </a>
    </li>
  );
}

export default async function InboxPage() {
  const result = await loadInbox();
  if (result === "login") {
    redirect("/login");
  }
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "1.25rem" }}>Inbox</h1>
      {result === "error" ? (
        <p style={{ color: "#b00020" }}>
          The inbox is unavailable right now. Please try again in a moment.
        </p>
      ) : result.items.length === 0 ? (
        <p style={{ color: "#555" }}>
          No conversations yet. Incoming mail appears here.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {result.items.map((item) => (
            <InboxRow key={item.conversationId} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}

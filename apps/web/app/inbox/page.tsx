import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BosApiError,
  bosApi,
  INBOX_FILTERS,
  type InboxFilter,
  type InboxItem,
  type InboxPage as InboxPageData,
} from "../../lib/bos-api";

export const metadata = { title: "Inbox — BOS" };

const pageStyle = {
  maxWidth: "640px",
  margin: "0 auto",
  padding: "1.5rem 1rem",
} as const;

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  needs_human: "Needs review",
  complaints: "Complaints",
};

function isInboxFilter(value: string | undefined): value is InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value ?? "");
}

async function loadInbox(
  filter: InboxFilter,
): Promise<InboxPageData | "login" | "error"> {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    return "login";
  }
  try {
    const query = filter === "all" ? "" : `?filter=${filter}`;
    return await bosApi<InboxPageData>(`/inbox${query}`, {
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

function FilterTabs({ current }: { current: InboxFilter }) {
  return (
    <nav
      style={{
        display: "flex",
        gap: "0.25rem",
        margin: "0.75rem 0 1rem",
        flexWrap: "wrap",
      }}
      aria-label="Inbox filters"
    >
      {INBOX_FILTERS.map((filter) => {
        const active = filter === current;
        return (
          <a
            key={filter}
            href={filter === "all" ? "/inbox" : `/inbox?filter=${filter}`}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "0.3rem 0.75rem",
              borderRadius: "999px",
              border: `1px solid ${active ? "#1a1a1a" : "#e2e2e2"}`,
              background: active ? "#1a1a1a" : "#fff",
              color: active ? "#fff" : "#1a1a1a",
              textDecoration: "none",
              fontSize: "0.85rem",
            }}
          >
            {FILTER_LABELS[filter]}
          </a>
        );
      })}
    </nav>
  );
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
          border: `1px solid ${item.urgent ? "#b00020" : "#e2e2e2"}`,
          borderRadius: "8px",
          textDecoration: "none",
          color: "inherit",
          background: item.urgent ? "#fff5f6" : "#fff",
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
          style={{
            marginTop: "0.25rem",
            fontSize: "0.75rem",
            color: "#777",
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {item.urgent ? (
            <span style={{ color: "#b00020", fontWeight: 600 }}>Urgent</span>
          ) : null}
          {item.lane ? <span>{item.lane}</span> : null}
          <span>{item.processing}</span>
        </div>
      </a>
    </li>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: rawFilter } = await searchParams;
  const filter = isInboxFilter(rawFilter) ? rawFilter : "all";
  const result = await loadInbox(filter);
  if (result === "login") {
    redirect("/login");
  }
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "1.25rem" }}>Inbox</h1>
      <FilterTabs current={filter} />
      {result === "error" ? (
        <p style={{ color: "#b00020" }}>
          The inbox is unavailable right now. Please try again in a moment.
        </p>
      ) : result.items.length === 0 ? (
        <p style={{ color: "#555" }}>
          No conversations here yet. Incoming mail appears in this list.
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

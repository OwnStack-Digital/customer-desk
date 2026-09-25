import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BosApiError, bosApi, type Thread } from "../../../lib/bos-api";
import {
  approveDraft,
  discardDraft,
  editDraft,
  sendDraft,
  takeOverConversation,
} from "./actions";

export const metadata = { title: "Conversation — BOS" };

type ThreadLoad = Thread | "login" | "not-found" | "error";

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
            </div>
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
          {result.messages.length === 0 ? (
            <p style={{ color: "#555" }}>This conversation has no messages.</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "1rem 0 0",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              {result.messages.map((message) => (
                <li
                  key={message.id}
                  style={{
                    border: "1px solid #e2e2e2",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    background:
                      message.direction === "inbound" ? "#fff" : "#f5f5f5",
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
                    <span>{message.from}</span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {message.direction} · {formatTime(message.at)}
                    </span>
                  </div>
                  {message.subject ? (
                    <div
                      style={{ margin: "0.5rem 0 0.25rem", fontWeight: 600 }}
                    >
                      {message.subject}
                    </div>
                  ) : null}
                  {/* Plain text only; HTML bodies are never rendered. */}
                  <p
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {message.text || "(no text body)"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

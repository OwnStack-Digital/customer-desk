import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BosApiError, bosApi, type Inbox } from "../../lib/bos-api";

export const metadata = { title: "Inbox — BOS" };

export default async function InboxPage() {
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) {
    redirect("/login");
  }
  let inbox: Inbox;
  try {
    inbox = await bosApi<Inbox>("/inbox", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401) {
      // Expired or revoked session: ask the operator to sign in again.
      redirect("/login");
    }
    throw error;
  }
  return (
    <main
      style={{
        maxWidth: "640px",
        margin: "0 auto",
        padding: "1.5rem 1rem",
      }}
    >
      <h1 style={{ fontSize: "1.25rem" }}>Inbox</h1>
      {inbox.items.length === 0 ? (
        <p style={{ color: "#555" }}>
          No conversations yet. Incoming mail appears here.
        </p>
      ) : (
        <ul>
          {inbox.items.map((item) => (
            <li key={String(item)}>{String(item)}</li>
          ))}
        </ul>
      )}
    </main>
  );
}

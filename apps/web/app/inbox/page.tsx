import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState } from "../../components/ui";
import { Workspace } from "../../components/workspace";
import {
  BosApiError,
  bosApi,
  INBOX_FILTERS,
  type InboxPage as InboxData,
  type InboxFilter,
} from "../../lib/bos-api";
import { InboxView } from "./view";

export const metadata = { title: "Inbox — OwnStack" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: rawFilter } = await searchParams;
  const filter: InboxFilter = INBOX_FILTERS.includes(rawFilter as InboxFilter)
    ? (rawFilter as InboxFilter)
    : "all";
  const session = (await cookies()).get("bos_session")?.value;
  if (!session) redirect("/login");
  let result: InboxData | undefined;
  try {
    result = await bosApi<InboxData>("/inbox", {
      headers: { cookie: `bos_session=${session}` },
    });
  } catch (error) {
    if (error instanceof BosApiError && error.status === 401)
      redirect("/login");
  }
  return (
    <Workspace>
      {result ? (
        <InboxView items={result.items} filter={filter} />
      ) : (
        <div className="panel">
          <EmptyState
            icon="alert"
            title="We couldn’t load your inbox"
            description="Your conversations are safe. Please try refreshing in a moment."
          >
            <a className="button button-secondary" href="/inbox">
              Try again
            </a>
          </EmptyState>
        </div>
      )}
    </Workspace>
  );
}

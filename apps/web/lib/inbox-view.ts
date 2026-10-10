import type { InboxFilter, InboxItem } from "./bos-api";

/** Keep these predicates aligned with GET /inbox's filter contract. */
export function matchesInboxFilter(
  item: InboxItem,
  filter: InboxFilter,
): boolean {
  return (
    filter === "all" ||
    (filter === "needs_human"
      ? item.processing === "needs_human"
      : item.lane === "complaint")
  );
}

export function selectInboxItems(
  items: InboxItem[],
  filter: InboxFilter,
  query: string,
  sort: "newest" | "oldest",
): InboxItem[] {
  const search = query.trim().toLowerCase();
  return items
    .filter((item) => matchesInboxFilter(item, filter))
    .filter((item) =>
      `${item.from.name ?? ""} ${item.from.address} ${item.subject ?? ""} ${item.preview}`
        .toLowerCase()
        .includes(search),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? Date.parse(a.latestAt) - Date.parse(b.latestAt)
        : Date.parse(b.latestAt) - Date.parse(a.latestAt),
    );
}

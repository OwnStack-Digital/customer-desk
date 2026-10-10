import { describe, expect, it } from "vitest";
import type { InboxItem } from "./bos-api";
import { matchesInboxFilter, selectInboxItems } from "./inbox-view";
import { formatMoney, formatTime, processingLabels } from "./presentation";

const items: InboxItem[] = [
  {
    conversationId: "a",
    from: { name: "Emma Wilson", address: "emma@example.com" },
    subject: "Weekly cleaning",
    preview: "Tuesday would suit",
    latestAt: "2026-01-01T01:00:00Z",
    processing: "ready",
    lane: "quote",
    urgent: false,
    automationPaused: false,
  },
  {
    conversationId: "b",
    from: { address: "grace@example.com" },
    subject: "A complaint",
    preview: "Please contact me",
    latestAt: "2026-01-02T01:00:00Z",
    processing: "needs_human",
    lane: "complaint",
    urgent: true,
    automationPaused: false,
  },
  {
    conversationId: "c",
    from: { address: "lucas@example.com" },
    preview: "Carpet steam cleaning",
    latestAt: "2026-01-03T01:00:00Z",
    processing: "needs_human",
    lane: "quote",
    urgent: false,
    automationPaused: false,
  },
];

describe("inbox presentation", () => {
  it("matches backend review and complaint filters independently", () => {
    expect(
      items
        .filter((item) => matchesInboxFilter(item, "needs_human"))
        .map((item) => item.conversationId),
    ).toEqual(["b", "c"]);
    expect(
      items
        .filter((item) => matchesInboxFilter(item, "complaints"))
        .map((item) => item.conversationId),
    ).toEqual(["b"]);
  });
  it.each([" EMMA ", "emma@example.com", "WEEKLY", "Tuesday"])(
    "searches names, addresses, subjects and preview without case sensitivity: %s",
    (query) => {
      expect(
        selectInboxItems(items, "all", query, "newest").map(
          (item) => item.conversationId,
        ),
      ).toEqual(["a"]);
    },
  );
  it("combines search and filters and handles absent names and subjects", () => {
    expect(
      selectInboxItems(items, "needs_human", "carpet", "newest").map(
        (item) => item.conversationId,
      ),
    ).toEqual(["c"]);
    expect(selectInboxItems(items, "complaints", "carpet", "newest")).toEqual(
      [],
    );
  });
  it("sorts in both directions without mutating the API array", () => {
    expect(
      selectInboxItems(items, "all", "", "newest").map(
        (item) => item.conversationId,
      ),
    ).toEqual(["c", "b", "a"]);
    expect(
      selectInboxItems(items, "all", "", "oldest").map(
        (item) => item.conversationId,
      ),
    ).toEqual(["a", "b", "c"]);
    expect(items.map((item) => item.conversationId)).toEqual(["a", "b", "c"]);
  });
  it("handles an empty inbox and unmatched search", () => {
    expect(selectInboxItems([], "all", "", "newest")).toEqual([]);
    expect(selectInboxItems(items, "all", "no matches", "newest")).toEqual([]);
  });
  it("uses readable, honest state labels", () => {
    expect(processingLabels.ready).toBe("Processed");
    expect(processingLabels.needs_human).toBe("Needs review");
    expect(processingLabels.failed).toBe("Processing failed");
  });
  it("formats dates in the stated timezone and preserves invalid input", () => {
    expect(formatTime("2026-01-01T01:00:00Z")).toMatch(/12:00/);
    expect(formatTime("unknown")).toBe("unknown");
    expect(formatMoney("AUD", 40700).replace(/\s/g, " ")).toBe("AUD 407.00");
  });
});

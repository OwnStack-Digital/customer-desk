import type { InboxItem, ProcessingStatus } from "./bos-api";

export const laneLabels: Record<NonNullable<InboxItem["lane"]>, string> = {
  faq: "General enquiry",
  quote: "Quote request",
  service: "Service request",
  complaint: "Complaint",
  quote_reply: "Quote reply",
  other: "Other",
  noise: "Automated mail",
};
export const processingLabels: Record<ProcessingStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Processed",
  needs_human: "Needs review",
  failed: "Processing failed",
};
export function processingTone(
  status: ProcessingStatus,
): "green" | "amber" | "red" | "neutral" {
  return status === "ready"
    ? "green"
    : status === "needs_human"
      ? "amber"
      : status === "failed"
        ? "red"
        : "neutral";
}
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Australia/Sydney",
      }).format(date);
}
export function formatMoney(currency: string, amountMinor: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(amountMinor / 100);
}

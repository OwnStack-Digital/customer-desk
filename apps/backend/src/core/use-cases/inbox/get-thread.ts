import type {
  Thread,
  ThreadQuote,
  ThreadTimelineEntry,
} from "../../domain/messaging";
import type { AuditEvent } from "../../domain/outbox";
import type { OwnerVisibleQuoteStatus, QuoteVersion } from "../../domain/quote";
import type { AuditEventRepository } from "../../ports/audit-event-repository";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { DraftRevisionRepository } from "../../ports/draft-revision-repository";
import type { MessageRepository } from "../../ports/message-repository";
import type { ProcessingRevisionRepository } from "../../ports/processing-revision-repository";
import type { QuoteVersionRepository } from "../../ports/quote-version-repository";

export interface GetThreadDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly drafts: DraftRevisionRepository;
  readonly quotes: QuoteVersionRepository;
  readonly audit: AuditEventRepository;
}

/**
 * One conversation with its messages (PLAN.md task 3.6). `processing` is
 * the latest revision of the conversation's latest message; `summary` is
 * always present once a revision completed. HTML is never returned. Unknown ids
 * resolve to `undefined` (HTTP layer maps that to 404).
 *
 * Slice 6: a quote-linked draft carries `totalMinor`/`currency` from the
 * immutable quote snapshot (never the current price list), and
 * `openQuote` reports the conversation's newest `prepared`/`sent` quote
 * version while one is still awaiting the customer's decision.
 * `quote` is that same version, or the newest accepted/declined version
 * once the customer (or the operator, confirming a reply) has decided.
 * Superseded versions stay hidden.
 */
export class GetThread {
  constructor(private readonly deps: GetThreadDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
  ): Promise<Thread | undefined> {
    const conversation = await this.deps.conversations.findById(
      organizationId,
      conversationId,
    );
    if (!conversation) {
      return undefined;
    }
    const messages = await this.deps.messages.listByConversation(
      organizationId,
      conversationId,
    );
    // Latest processed turn, not merely the latest row. An owner email to
    // the customer has no revision and must not hide the assistant result.
    let latestRevision: Awaited<
      ReturnType<ProcessingRevisionRepository["findLatestByMessage"]>
    >;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      const revision = await this.deps.revisions.findLatestByMessage(
        organizationId,
        message.id,
      );
      if (revision) {
        latestRevision = revision;
        break;
      }
    }
    // Task 4.5: the newest proposed/approved draft of the conversation,
    // with the fact ids its body is grounded in.
    const draft = await this.deps.drafts.findLatestByConversation(
      organizationId,
      conversationId,
    );
    const quote =
      draft && draft.quoteVersionId !== null
        ? await this.deps.quotes.findById(organizationId, draft.quoteVersionId)
        : undefined;
    const threadDraft =
      draft && (draft.status === "proposed" || draft.status === "approved")
        ? {
            revisionId: draft.id,
            status: draft.status,
            bodyText: draft.bodyText,
            assumptions: [...draft.assumptions],
            ...(draft.factIds.length > 0
              ? { factIds: [...draft.factIds] }
              : {}),
            ...(quote
              ? { totalMinor: quote.totalMinor, currency: quote.currency }
              : {}),
          }
        : undefined;
    // Slice 6: the conversation's open quote version (newest prepared,
    // else newest sent). Decided and superseded versions never appear.
    const openQuote = await this.deps.quotes.findLatestOpenByConversation(
      organizationId,
      conversationId,
    );
    // A recorded accept/decline is not open, but the owner still needs to
    // see it. Superseded versions are revoked and stay off the thread.
    const visibleQuotes = await this.deps.quotes.listByConversation(
      organizationId,
      conversationId,
    );
    const threadQuotes = visibleQuotes
      .filter((version) => isOwnerVisible(version.status))
      .map((version) => threadQuoteOf(version));
    const visibleQuote = threadQuotes.at(-1);
    const draftRows = await this.deps.drafts.listByConversation(
      organizationId,
      conversationId,
    );
    const events = await this.deps.audit.listByEntityIds(organizationId, [
      conversation.id,
      ...messages.map((message) => message.id),
      ...visibleQuotes.map((version) => version.id),
      ...draftRows.map((draft) => draft.id),
    ]);
    return {
      conversation: {
        id: conversation.id,
        customer: {
          address: conversation.fromAddress,
          name: conversation.fromName ?? undefined,
        },
        subject: conversation.subject ?? undefined,
        automationPaused: conversation.automationPaused,
      },
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        at: message.receivedAt,
        from: message.fromAddress,
        subject: message.subject ?? undefined,
        text: message.text ?? undefined,
      })),
      processing: latestRevision
        ? {
            status: latestRevision.status,
            lane: latestRevision.lane ?? undefined,
            summary: latestRevision.summary ?? "",
          }
        : undefined,
      // Slice 7 (task 7.1): the service lane's internal note, surfaced from
      // the stored classification artifact. Internal only — no draft.
      ...(latestRevision?.classification?.service
        ? {
            serviceNote: {
              request: latestRevision.classification.service.request,
              supplied: [...latestRevision.classification.service.supplied],
              missing: [...latestRevision.classification.service.missing],
              nextAction: latestRevision.classification.service.nextAction,
            },
          }
        : {}),
      // Slice 7 (task 7.3): the quote-reply intent and its candidate sent
      // quote versions, for the owner's explicit confirm decision.
      ...(latestRevision?.classification?.quoteReply
        ? {
            quoteReply: {
              intent: latestRevision.classification.quoteReply.intent,
              candidateQuoteVersionIds: [
                ...(latestRevision.classification.quoteReply
                  .candidateQuoteVersionIds ?? []),
              ],
            },
          }
        : {}),
      draft: threadDraft,
      ...(openQuote
        ? {
            openQuote: {
              quoteVersionId: openQuote.id,
              status: openQuote.status,
              totalMinor: openQuote.totalMinor,
              currency: openQuote.currency,
            },
          }
        : {}),
      ...(visibleQuote ? { quote: visibleQuote } : {}),
      quotes: threadQuotes,
      timeline: timelineOf(messages, events),
    };
  }
}

const EVENT_LABELS: Record<string, string> = {
  "quote.accepted": "Quote accepted",
  "quote.declined": "Quote declined",
  "quote.revised": "Updated quote prepared",
  "quote.sent": "Quote link sent",
  "draft.approved": "Draft approved",
  "draft.edited": "Draft edited",
  "draft.discarded": "Draft discarded",
  "conversation.takeover": "Took over the conversation",
};

/** Message sends are the sent/received rows. These actions are not repeated. */
const HIDDEN_EVENTS = new Set([
  "message.sent",
  "message.received",
  "draft.sent",
]);

function timelineOf(
  messages: readonly {
    id: string;
    direction: "inbound" | "outbound" | "instruction";
    receivedAt: string;
    fromAddress: string;
    subject: string | null;
    text: string | null;
  }[],
  events: readonly AuditEvent[],
): ThreadTimelineEntry[] {
  const entries: ThreadTimelineEntry[] = [
    ...messages.map(
      (message): ThreadTimelineEntry => ({
        kind:
          message.direction === "inbound"
            ? "received"
            : message.direction === "instruction"
              ? "instruction"
              : "sent",
        id: message.id,
        at: message.receivedAt,
        from: message.fromAddress,
        ...(message.subject ? { subject: message.subject } : {}),
        ...(message.text ? { text: message.text } : {}),
      }),
    ),
    ...events.flatMap((event): ThreadTimelineEntry[] => {
      const label = EVENT_LABELS[event.action];
      if (!label || HIDDEN_EVENTS.has(event.action)) {
        return [];
      }
      return [
        {
          kind: "event",
          id: event.id,
          at: event.createdAt,
          actor: event.actor,
          action: event.action,
          label,
        },
      ];
    }),
  ];
  return entries.sort(
    (left, right) =>
      left.at.localeCompare(right.at) ||
      kindOrder(left.kind) - kindOrder(right.kind) ||
      left.id.localeCompare(right.id),
  );
}

function kindOrder(kind: ThreadTimelineEntry["kind"]): number {
  if (kind === "received") {
    return 0;
  }
  if (kind === "sent") {
    return 1;
  }
  return 2;
}

function isOwnerVisible(
  status: QuoteVersion["status"],
): status is OwnerVisibleQuoteStatus {
  return status !== "superseded";
}

function threadQuoteOf(quote: QuoteVersion): ThreadQuote {
  if (!isOwnerVisible(quote.status)) {
    throw new Error(`Quote ${quote.id} is not owner-visible.`);
  }
  return {
    quoteVersionId: quote.id,
    status: quote.status,
    totalMinor: quote.totalMinor,
    currency: quote.currency,
    ...(quote.decision ? { decision: quote.decision } : {}),
    ...(quote.decidedAt ? { decidedAt: quote.decidedAt } : {}),
    lines: quote.lines.map((line) => ({
      ruleId: line.ruleId,
      name: line.name,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      amountMinor: line.amountMinor,
      ...(line.includedInTotal === false ? { includedInTotal: false } : {}),
    })),
  };
}

/** DI token (composition root only; the use case itself is framework-free). */
export const GET_THREAD = "GetThread";

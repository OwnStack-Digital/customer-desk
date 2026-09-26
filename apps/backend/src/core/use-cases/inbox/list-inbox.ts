import type { InboxFilter, InboxItem, InboxPage } from "../../domain/messaging";
import type { OwnerVisibleQuoteStatus } from "../../domain/quote";
import type { ConversationRepository } from "../../ports/conversation-repository";
import type { MessageRepository } from "../../ports/message-repository";
import type { ProcessingRevisionRepository } from "../../ports/processing-revision-repository";
import type { QuoteVersionRepository } from "../../ports/quote-version-repository";

export interface ListInboxDeps {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly quotes: QuoteVersionRepository;
}

/** Plain-text inbox preview length (slice 2: text only, never HTML). */
export const PREVIEW_MAX_LENGTH = 140;

/**
 * Lists conversations newest activity first (PLAN.md task 3.6). Each item
 * carries the processing outcome of its latest message's latest revision:
 * `pending` when no revision exists yet, the revision status otherwise.
 * Complaints are urgent; `needs_human` / `complaints` are the owner
 * filters. Filtering happens here, not in a controller.
 *
 * `quoteStatus` is the newest non-superseded quote. A public accept or
 * decline does not insert a message, so without this the inbox cannot
 * show that the customer decided.
 */
export class ListInbox {
  constructor(private readonly deps: ListInboxDeps) {}

  async run(
    organizationId: string,
    filter: InboxFilter = "all",
  ): Promise<InboxPage> {
    const conversations =
      await this.deps.conversations.listByOrganization(organizationId);
    const latest =
      await this.deps.messages.findLatestPerConversation(organizationId);
    const latestByConversation = new Map(
      latest.map((message) => [message.conversationId, message]),
    );
    const revisions =
      await this.deps.revisions.findLatestPerMessage(organizationId);
    const revisionByMessage = new Map(
      revisions.map((revision) => [revision.messageId, revision]),
    );
    const quotes =
      await this.deps.quotes.findLatestVisiblePerConversation(organizationId);
    const quoteByConversation = new Map(
      quotes.map((quote) => [quote.conversationId, quote]),
    );

    const items = conversations
      .map((conversation): InboxItem => {
        const message = latestByConversation.get(conversation.id);
        const revision = message
          ? revisionByMessage.get(message.id)
          : undefined;
        const quote = quoteByConversation.get(conversation.id);
        const quoteStatus =
          quote && quote.status !== "superseded"
            ? (quote.status as OwnerVisibleQuoteStatus)
            : undefined;
        return {
          conversationId: conversation.id,
          from: {
            address: conversation.fromAddress,
            name: conversation.fromName ?? undefined,
          },
          subject: conversation.subject ?? undefined,
          latestAt: message ? message.receivedAt : conversation.createdAt,
          lane: revision?.lane ?? undefined,
          processing: revision?.status ?? "pending",
          urgent: revision?.lane === "complaint",
          automationPaused: conversation.automationPaused,
          preview: previewOf(message?.text ?? undefined),
          ...(quoteStatus ? { quoteStatus } : {}),
        };
      })
      .filter((item) =>
        filter === "needs_human"
          ? item.processing === "needs_human"
          : filter === "complaints"
            ? item.lane === "complaint"
            : true,
      )
      // ISO-8601 strings sort chronologically as plain text.
      .sort((left, right) => right.latestAt.localeCompare(left.latestAt));

    return { items };
  }
}

/** Short single-line plain-text preview; whitespace collapses, HTML never. */
function previewOf(text: string | undefined): string {
  if (!text) {
    return "";
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= PREVIEW_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const LIST_INBOX = "ListInbox";

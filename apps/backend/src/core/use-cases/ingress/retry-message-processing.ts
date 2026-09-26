import type { ProcessingResult } from "../../domain/processing";
import type { MessageRepository } from "../../ports/message-repository";
import type { ProcessingRevisionRepository } from "../../ports/processing-revision-repository";
import type { ProcessInboundMessage } from "./process-inbound-message";

export interface RetryMessageProcessingDeps {
  readonly messages: MessageRepository;
  readonly revisions: ProcessingRevisionRepository;
  readonly processing: ProcessInboundMessage;
}

/**
 * Appends a new processing revision for one message (PLAN.md task 3.5) via
 * the owner route `POST /messages/:messageId/retry-processing`. Idempotent
 * while a revision of that message is currently `processing`: the in-flight
 * revision is returned and no second attempt is stacked. The message is
 * never deleted or mutated. Returns `undefined` for an unknown message so
 * the HTTP layer can map it to 404.
 */
export class RetryMessageProcessing {
  constructor(private readonly deps: RetryMessageProcessingDeps) {}

  async run(
    organizationId: string,
    messageId: string,
  ): Promise<ProcessingResult | undefined> {
    const message = await this.deps.messages.findById(
      organizationId,
      messageId,
    );
    if (!message) {
      return undefined;
    }
    const latest = await this.deps.revisions.findLatestByMessage(
      organizationId,
      messageId,
    );
    if (latest?.status === "processing") {
      // Already in flight: return the running revision, do not stack.
      return {
        revisionId: latest.id,
        status: "processing",
        lane: latest.lane ?? undefined,
        summary: latest.summary ?? "Processing is already running.",
      };
    }
    return this.deps.processing.run(organizationId, messageId);
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const RETRY_MESSAGE_PROCESSING = "RetryMessageProcessing";

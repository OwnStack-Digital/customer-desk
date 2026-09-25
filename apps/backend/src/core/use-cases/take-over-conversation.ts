import type { AuditEvent } from "../domain/outbox";
import type { AuditEventRepository } from "../ports/audit-event-repository";
import type { Clock } from "../ports/clock";
import type { ConversationRepository } from "../ports/conversation-repository";
import type { IdGenerator } from "../ports/id-generator";

export interface TakeOverConversationDeps {
  readonly conversations: ConversationRepository;
  readonly audit: AuditEventRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Take-over (PLAN.md task 5.4): `POST /threads/:conversationId/take-over`
 * sets `conversation.automationPaused`. Later mail is still classified and
 * still raises complaint / human items, but processing never supersedes,
 * replaces, or creates a machine draft while paused — replies are manual.
 * Returns the paused state, or `undefined` for an unknown conversation.
 */
export class TakeOverConversation {
  constructor(private readonly deps: TakeOverConversationDeps) {}

  async run(
    organizationId: string,
    conversationId: string,
    actor: string,
  ): Promise<boolean | undefined> {
    const paused = await this.deps.conversations.setAutomationPaused(
      organizationId,
      conversationId,
      true,
    );
    if (!paused) {
      return undefined;
    }
    await this.deps.audit.insertEvent({
      id: this.deps.ids.nextId(),
      organizationId,
      actor,
      action: "conversation.takeover",
      entityType: "conversation",
      entityId: conversationId,
      revisionId: null,
      correlationId: null,
      createdAt: this.deps.clock.now().toISOString(),
    });
    return true;
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const TAKE_OVER_CONVERSATION = "TakeOverConversation";
import type { OutboxPage } from "../domain/outbox";
import type { OutboxRepository } from "../ports/outbox-repository";

/**
 * `GET /outbox` (PLAN.md task 5.3): queued/failed/uncertain rows of the
 * organization, newest first. The demonstrator has no `sent` from a
 * provider — no route ever marks a row beyond `queued`.
 */
export class ListOutbox {
  constructor(private readonly outbox: OutboxRepository) {}

  async run(organizationId: string): Promise<OutboxPage> {
    return { items: await this.outbox.listByOrganization(organizationId) };
  }
}

/** DI token (composition root only; the use case itself is framework-free). */
export const LIST_OUTBOX = "ListOutbox";

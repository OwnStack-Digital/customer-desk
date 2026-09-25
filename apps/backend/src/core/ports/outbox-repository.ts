import type { OutboxEntry, OutboxItem } from "../domain/outbox";

/** Outbox persistence (PLAN.md slice 5). */
export interface OutboxRepository {
  /** Inserts one outbox row (status starts as `queued` here). */
  insertOutbox(entry: OutboxEntry): Promise<void>;

  /** Every row of the organization, newest first. */
  listByOrganization(organizationId: string): Promise<OutboxItem[]>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const OUTBOX_REPOSITORY = "OutboxRepository";

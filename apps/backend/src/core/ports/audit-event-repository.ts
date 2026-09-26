import type { AuditEvent } from "../domain/outbox";

/** Audit-trail persistence (PLAN.md slice 5). */
export interface AuditEventRepository {
  insertEvent(event: AuditEvent): Promise<void>;

  /** Audit rows whose entity id is one of the given ids, oldest first. */
  listByEntityIds(
    organizationId: string,
    entityIds: readonly string[],
  ): Promise<readonly AuditEvent[]>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const AUDIT_EVENT_REPOSITORY = "AuditEventRepository";

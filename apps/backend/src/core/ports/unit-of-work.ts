import type { AuditEventRepository } from "./audit-event-repository";
import type { DraftRevisionRepository } from "./draft-revision-repository";
import type { MessageRepository } from "./message-repository";
import type { OutboxRepository } from "./outbox-repository";
import type { QuoteVersionRepository } from "./quote-version-repository";

/**
 * Repositories scoped to the open transaction (PLAN.md `UnitOfWork` wraps
 * the send transaction and the quote-decision transaction). The use case
 * never knows the transaction mechanism; the adapter hands it these
 * scoped repositories.
 */
export interface TransactionScopedRepositories {
  readonly messages: MessageRepository;
  readonly drafts: DraftRevisionRepository;
  readonly outbox: OutboxRepository;
  readonly audit: AuditEventRepository;
  readonly quotes: QuoteVersionRepository;
}

/**
 * Atomic unit of work (PLAN.md slice 5): `fn` runs inside one database
 * transaction with the scoped repositories; any throw rolls every insert
 * and update inside it back.
 */
export interface UnitOfWork {
  run<T>(fn: (repos: TransactionScopedRepositories) => Promise<T>): Promise<T>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const UNIT_OF_WORK = "UnitOfWork";

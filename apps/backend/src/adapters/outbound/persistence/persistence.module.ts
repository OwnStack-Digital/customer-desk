import { Module } from "@nestjs/common";
import { AUDIT_EVENT_REPOSITORY } from "../../../core/ports/audit-event-repository";
import { CONVERSATION_REPOSITORY } from "../../../core/ports/conversation-repository";
import { DRAFT_REVISION_REPOSITORY } from "../../../core/ports/draft-revision-repository";
import { MESSAGE_REPOSITORY } from "../../../core/ports/message-repository";
import { OPERATOR_CREDENTIAL_REPOSITORY } from "../../../core/ports/operator-credential-repository";
import { OUTBOX_REPOSITORY } from "../../../core/ports/outbox-repository";
import { PROCESSING_REVISION_REPOSITORY } from "../../../core/ports/processing-revision-repository";
import { QUOTE_VERSION_REPOSITORY } from "../../../core/ports/quote-version-repository";
import { SESSION_REPOSITORY } from "../../../core/ports/session-repository";
import { UNIT_OF_WORK } from "../../../core/ports/unit-of-work";
import {
  createPersistenceClient,
  PERSISTENCE_CLIENT,
  type PersistenceClient,
} from "./client";
import { DrizzleOperatorCredentialRepository } from "./repositories/auth/operator-credential-repository";
import { DrizzleSessionRepository } from "./repositories/auth/session-repository";
import { DrizzleAuditEventRepository } from "./repositories/delivery/audit-event-repository";
import { DrizzleOutboxRepository } from "./repositories/delivery/outbox-repository";
import { DrizzleConversationRepository } from "./repositories/messaging/conversation-repository";
import { DrizzleDraftRevisionRepository } from "./repositories/messaging/draft-revision-repository";
import { DrizzleMessageRepository } from "./repositories/messaging/message-repository";
import { DrizzleProcessingRevisionRepository } from "./repositories/messaging/processing-revision-repository";
import { DrizzleQuoteVersionRepository } from "./repositories/quotes/quote-version-repository";
import { DrizzleUnitOfWork } from "./unit-of-work";

@Module({
  providers: [
    {
      provide: PERSISTENCE_CLIENT,
      useFactory: () => createPersistenceClient(),
    },
    {
      provide: OPERATOR_CREDENTIAL_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleOperatorCredentialRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: SESSION_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleSessionRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: CONVERSATION_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleConversationRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: MESSAGE_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleMessageRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: PROCESSING_REVISION_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleProcessingRevisionRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: DRAFT_REVISION_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleDraftRevisionRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: OUTBOX_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleOutboxRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: AUDIT_EVENT_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleAuditEventRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: QUOTE_VERSION_REPOSITORY,
      useFactory: (client: PersistenceClient) =>
        new DrizzleQuoteVersionRepository(client),
      inject: [PERSISTENCE_CLIENT],
    },
    {
      provide: UNIT_OF_WORK,
      useFactory: (client: PersistenceClient) => new DrizzleUnitOfWork(client),
      inject: [PERSISTENCE_CLIENT],
    },
  ],
  exports: [
    PERSISTENCE_CLIENT,
    OPERATOR_CREDENTIAL_REPOSITORY,
    SESSION_REPOSITORY,
    CONVERSATION_REPOSITORY,
    MESSAGE_REPOSITORY,
    PROCESSING_REVISION_REPOSITORY,
    DRAFT_REVISION_REPOSITORY,
    OUTBOX_REPOSITORY,
    AUDIT_EVENT_REPOSITORY,
    QUOTE_VERSION_REPOSITORY,
    UNIT_OF_WORK,
  ],
})
export class PersistenceModule {}

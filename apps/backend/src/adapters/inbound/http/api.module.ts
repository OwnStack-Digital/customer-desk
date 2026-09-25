import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  AUDIT_EVENT_REPOSITORY,
  type AuditEventRepository,
} from "../../../core/ports/audit-event-repository";
import {
  CLASSIFIER_PORT,
  type ClassifierPort,
} from "../../../core/ports/classifier";
import { CLOCK, type Clock } from "../../../core/ports/clock";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../../../core/ports/conversation-repository";
import {
  DRAFT_REVISION_REPOSITORY,
  type DraftRevisionRepository,
} from "../../../core/ports/draft-revision-repository";
import { DRAFTER_PORT, type DrafterPort } from "../../../core/ports/drafter";
import {
  ID_GENERATOR,
  type IdGenerator,
} from "../../../core/ports/id-generator";
import {
  KNOWLEDGE_BASE_REPOSITORY,
  type KnowledgeBaseRepository,
} from "../../../core/ports/knowledge-base-repository";
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
} from "../../../core/ports/message-repository";
import {
  OPERATOR_CREDENTIAL_REPOSITORY,
  type OperatorCredentialRepository,
} from "../../../core/ports/operator-credential-repository";
import {
  ORGANIZATION_PROFILE_REPOSITORY,
  type OrganizationProfileRepository,
} from "../../../core/ports/organization-profile-repository";
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from "../../../core/ports/outbox-repository";
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from "../../../core/ports/password-hasher";
import {
  PRICE_LIST_REPOSITORY,
  type PriceListRepository,
} from "../../../core/ports/price-list-repository";
import {
  PROCESSING_REVISION_REPOSITORY,
  type ProcessingRevisionRepository,
} from "../../../core/ports/processing-revision-repository";
import {
  QUOTE_VERSION_REPOSITORY,
  type QuoteVersionRepository,
} from "../../../core/ports/quote-version-repository";
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from "../../../core/ports/session-repository";
import {
  TOKEN_GENERATOR,
  type TokenGenerator,
} from "../../../core/ports/token-generator";
import {
  TOKEN_HASHER,
  type TokenHasher,
} from "../../../core/ports/token-hasher";
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from "../../../core/ports/unit-of-work";
import {
  AUTHENTICATE_SESSION,
  AuthenticateSession,
  type AuthenticateSessionDeps,
} from "../../../core/use-cases/authenticate-session";
import {
  CONFIRM_QUOTE_DECISION,
  ConfirmQuoteDecision,
} from "../../../core/use-cases/confirm-quote-decision";
import { GET_THREAD, GetThread } from "../../../core/use-cases/get-thread";
import { LIST_INBOX, ListInbox } from "../../../core/use-cases/list-inbox";
import { LIST_OUTBOX, ListOutbox } from "../../../core/use-cases/list-outbox";
import { LOGIN, Login } from "../../../core/use-cases/login";
import {
  LOGOUT,
  Logout,
  type LogoutDeps,
} from "../../../core/use-cases/logout";
import {
  PROCESS_INBOUND_MESSAGE,
  ProcessInboundMessage,
} from "../../../core/use-cases/process-inbound-message";
import {
  RECEIVE_INBOUND_EMAIL,
  ReceiveInboundEmail,
} from "../../../core/use-cases/receive-inbound-email";
import {
  GET_PUBLIC_QUOTE,
  GetPublicQuote,
  RECORD_QUOTE_DECISION,
  RecordQuoteDecision,
} from "../../../core/use-cases/record-quote-decision";
import {
  RETRY_MESSAGE_PROCESSING,
  RetryMessageProcessing,
} from "../../../core/use-cases/retry-message-processing";
import {
  REVIEW_DRAFT,
  ReviewDraft,
} from "../../../core/use-cases/review-draft";
import {
  SEED_OWNER,
  SeedOwner,
  type SeedOwnerDeps,
} from "../../../core/use-cases/seed-owner";
import {
  SEND_APPROVED_DRAFT,
  SendApprovedDraft,
} from "../../../core/use-cases/send-approved-draft";
import {
  TAKE_OVER_CONVERSATION,
  TakeOverConversation,
} from "../../../core/use-cases/take-over-conversation";
import { OwnerSeeder } from "../../../infrastructure/composition/owner-seeder";
import { AiModule } from "../../outbound/ai/ai.module";
import { ConfigModule } from "../../outbound/config-files/config.module";
import { DrizzleAuditEventRepository } from "../../outbound/persistence/audit-event-repository";
import {
  PERSISTENCE_CLIENT,
  type PersistenceClient,
} from "../../outbound/persistence/client";
import { DrizzleConversationRepository } from "../../outbound/persistence/conversation-repository";
import { DrizzleDraftRevisionRepository } from "../../outbound/persistence/draft-revision-repository";
import { DrizzleMessageRepository } from "../../outbound/persistence/message-repository";
import { DrizzleOperatorCredentialRepository } from "../../outbound/persistence/operator-credential-repository";
import { DrizzleOutboxRepository } from "../../outbound/persistence/outbox-repository";
import { PersistenceModule } from "../../outbound/persistence/persistence.module";
import { DrizzleProcessingRevisionRepository } from "../../outbound/persistence/processing-revision-repository";
import { DrizzleQuoteVersionRepository } from "../../outbound/persistence/quote-version-repository";
import { DrizzleSessionRepository } from "../../outbound/persistence/session-repository";
import { DrizzleUnitOfWork } from "../../outbound/persistence/unit-of-work";
import { Argon2PasswordHasher } from "../../outbound/security/argon2-password-hasher";
import {
  INGRESS_KEY_COMPARER,
  TimingSafeIngressKeyComparer,
} from "../../outbound/security/ingress-key-comparer";
import { RandomTokenGenerator } from "../../outbound/security/random-token-generator";
import { Sha256TokenHasher } from "../../outbound/security/sha256-token-hasher";
import { SystemClock } from "../../outbound/security/system-clock";
import { UlidGenerator } from "../../outbound/security/ulid-id-generator";
import { AuthController } from "./auth.controller";
import { DraftsController } from "./drafts.controller";
import { ErrorBodyFilter } from "./error-body.filter";
import { HealthController } from "./health.controller";
import { InboxController } from "./inbox.controller";
import { IngressController } from "./ingress.controller";
import { IngressGuard } from "./ingress.guard";
import { MessagesController } from "./messages.controller";
import { OutboxController } from "./outbox.controller";
import { PublicQuotesController } from "./public-quotes.controller";
import { SendController } from "./send.controller";
import { SessionGuard } from "./session.guard";

/** 7-day absolute session lifetime (docs/PLAN.md frozen choices). */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Module({
  imports: [ConfigModule, PersistenceModule, AiModule],
  controllers: [
    HealthController,
    AuthController,
    InboxController,
    IngressController,
    MessagesController,
    DraftsController,
    SendController,
    OutboxController,
    PublicQuotesController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorBodyFilter },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_HASHER, useClass: Sha256TokenHasher },
    { provide: TOKEN_GENERATOR, useClass: RandomTokenGenerator },
    { provide: ID_GENERATOR, useClass: UlidGenerator },
    { provide: CLOCK, useClass: SystemClock },
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
    {
      provide: INGRESS_KEY_COMPARER,
      useFactory: (): TimingSafeIngressKeyComparer =>
        new TimingSafeIngressKeyComparer(process.env.BOS_INGRESS_KEY),
    },
    {
      provide: LOGIN,
      useFactory: async (
        credentials: OperatorCredentialRepository,
        sessions: SessionRepository,
        hasher: PasswordHasher,
        tokenHasher: TokenHasher,
        clock: Clock,
        ids: IdGenerator,
      ): Promise<Login> =>
        new Login({
          credentials,
          sessions,
          hasher,
          tokenHasher,
          clock,
          ids,
          sessionLifetimeMs: SESSION_LIFETIME_MS,
          // Verified on unknown email so login always performs one argon2
          // verification (constant work; no enumeration via timing).
          dummyHash: await hasher.hash("bos-login-constant-work"),
        }),
      inject: [
        OPERATOR_CREDENTIAL_REPOSITORY,
        SESSION_REPOSITORY,
        PASSWORD_HASHER,
        TOKEN_HASHER,
        CLOCK,
        ID_GENERATOR,
      ],
    },
    {
      provide: AUTHENTICATE_SESSION,
      useFactory: (
        sessions: AuthenticateSessionDeps["sessions"],
        tokenHasher: AuthenticateSessionDeps["tokenHasher"],
        clock: AuthenticateSessionDeps["clock"],
      ): AuthenticateSession =>
        new AuthenticateSession({ sessions, tokenHasher, clock }),
      inject: [SESSION_REPOSITORY, TOKEN_HASHER, CLOCK],
    },
    {
      provide: LOGOUT,
      useFactory: (
        sessions: LogoutDeps["sessions"],
        tokenHasher: LogoutDeps["tokenHasher"],
        clock: LogoutDeps["clock"],
      ): Logout => new Logout({ sessions, tokenHasher, clock }),
      inject: [SESSION_REPOSITORY, TOKEN_HASHER, CLOCK],
    },
    {
      provide: SEED_OWNER,
      useFactory: (
        credentials: SeedOwnerDeps["credentials"],
        hasher: SeedOwnerDeps["hasher"],
        ids: SeedOwnerDeps["ids"],
        clock: SeedOwnerDeps["clock"],
      ): SeedOwner => new SeedOwner({ credentials, hasher, ids, clock }),
      inject: [
        OPERATOR_CREDENTIAL_REPOSITORY,
        PASSWORD_HASHER,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: PROCESS_INBOUND_MESSAGE,
      useFactory: (
        messages: MessageRepository,
        conversations: ConversationRepository,
        revisions: ProcessingRevisionRepository,
        drafts: DraftRevisionRepository,
        classifier: ClassifierPort,
        drafter: DrafterPort,
        knowledgeBase: KnowledgeBaseRepository,
        priceList: PriceListRepository,
        profile: OrganizationProfileRepository,
        quotes: QuoteVersionRepository,
        ids: IdGenerator,
        clock: Clock,
      ): ProcessInboundMessage =>
        new ProcessInboundMessage({
          messages,
          conversations,
          revisions,
          drafts,
          classifier,
          drafter,
          knowledgeBase,
          priceList,
          profile,
          quotes,
          ids,
          clock,
        }),
      inject: [
        MESSAGE_REPOSITORY,
        CONVERSATION_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
        DRAFT_REVISION_REPOSITORY,
        CLASSIFIER_PORT,
        DRAFTER_PORT,
        KNOWLEDGE_BASE_REPOSITORY,
        PRICE_LIST_REPOSITORY,
        ORGANIZATION_PROFILE_REPOSITORY,
        QUOTE_VERSION_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: RETRY_MESSAGE_PROCESSING,
      useFactory: (
        messages: MessageRepository,
        revisions: ProcessingRevisionRepository,
        processing: ProcessInboundMessage,
      ): RetryMessageProcessing =>
        new RetryMessageProcessing({ messages, revisions, processing }),
      inject: [
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
        PROCESS_INBOUND_MESSAGE,
      ],
    },
    {
      provide: RECEIVE_INBOUND_EMAIL,
      useFactory: (
        conversations: ConversationRepository,
        messages: MessageRepository,
        revisions: ProcessingRevisionRepository,
        profile: OrganizationProfileRepository,
        processing: ProcessInboundMessage,
        ids: IdGenerator,
        clock: Clock,
      ): ReceiveInboundEmail =>
        new ReceiveInboundEmail({
          conversations,
          messages,
          revisions,
          profile,
          processing,
          ids,
          clock,
        }),
      inject: [
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
        ORGANIZATION_PROFILE_REPOSITORY,
        PROCESS_INBOUND_MESSAGE,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: LIST_INBOX,
      useFactory: (
        conversations: ConversationRepository,
        messages: MessageRepository,
        revisions: ProcessingRevisionRepository,
      ): ListInbox => new ListInbox({ conversations, messages, revisions }),
      inject: [
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
      ],
    },
    {
      provide: GET_THREAD,
      useFactory: (
        conversations: ConversationRepository,
        messages: MessageRepository,
        revisions: ProcessingRevisionRepository,
        drafts: DraftRevisionRepository,
        quotes: QuoteVersionRepository,
      ): GetThread =>
        new GetThread({ conversations, messages, revisions, drafts, quotes }),
      inject: [
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
        DRAFT_REVISION_REPOSITORY,
        QUOTE_VERSION_REPOSITORY,
      ],
    },
    {
      provide: REVIEW_DRAFT,
      useFactory: (
        drafts: DraftRevisionRepository,
        audit: AuditEventRepository,
        ids: IdGenerator,
        clock: Clock,
      ): ReviewDraft => new ReviewDraft({ drafts, audit, ids, clock }),
      inject: [
        DRAFT_REVISION_REPOSITORY,
        AUDIT_EVENT_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: TAKE_OVER_CONVERSATION,
      useFactory: (
        conversations: ConversationRepository,
        audit: AuditEventRepository,
        ids: IdGenerator,
        clock: Clock,
      ): TakeOverConversation =>
        new TakeOverConversation({ conversations, audit, ids, clock }),
      inject: [
        CONVERSATION_REPOSITORY,
        AUDIT_EVENT_REPOSITORY,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: SEND_APPROVED_DRAFT,
      useFactory: (
        conversations: ConversationRepository,
        drafts: DraftRevisionRepository,
        profile: OrganizationProfileRepository,
        unitOfWork: UnitOfWork,
        quotes: QuoteVersionRepository,
        tokens: TokenGenerator,
        tokenHasher: TokenHasher,
        ids: IdGenerator,
        clock: Clock,
      ): SendApprovedDraft =>
        new SendApprovedDraft({
          conversations,
          drafts,
          profile,
          unitOfWork,
          quotes,
          tokens,
          tokenHasher,
          // No default in production (PLAN.md): sending a quote draft
          // fails closed when PUBLIC_APP_URL is unset.
          publicAppUrl: process.env.PUBLIC_APP_URL,
          ids,
          clock,
        }),
      inject: [
        CONVERSATION_REPOSITORY,
        DRAFT_REVISION_REPOSITORY,
        ORGANIZATION_PROFILE_REPOSITORY,
        UNIT_OF_WORK,
        QUOTE_VERSION_REPOSITORY,
        TOKEN_GENERATOR,
        TOKEN_HASHER,
        ID_GENERATOR,
        CLOCK,
      ],
    },
    {
      provide: GET_PUBLIC_QUOTE,
      useFactory: (
        quotes: QuoteVersionRepository,
        tokenHasher: TokenHasher,
        profile: OrganizationProfileRepository,
        clock: Clock,
      ): GetPublicQuote =>
        new GetPublicQuote({ quotes, tokenHasher, profile, clock }),
      inject: [
        QUOTE_VERSION_REPOSITORY,
        TOKEN_HASHER,
        ORGANIZATION_PROFILE_REPOSITORY,
        CLOCK,
      ],
    },
    {
      provide: RECORD_QUOTE_DECISION,
      useFactory: (
        quotes: QuoteVersionRepository,
        tokenHasher: TokenHasher,
        profile: OrganizationProfileRepository,
        clock: Clock,
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
      ): RecordQuoteDecision =>
        new RecordQuoteDecision({
          quotes,
          tokenHasher,
          profile,
          clock,
          unitOfWork,
          ids,
        }),
      inject: [
        QUOTE_VERSION_REPOSITORY,
        TOKEN_HASHER,
        ORGANIZATION_PROFILE_REPOSITORY,
        CLOCK,
        UNIT_OF_WORK,
        ID_GENERATOR,
      ],
    },
    {
      provide: CONFIRM_QUOTE_DECISION,
      useFactory: (
        quotes: QuoteVersionRepository,
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
      ): ConfirmQuoteDecision =>
        new ConfirmQuoteDecision({ quotes, unitOfWork, ids, clock }),
      inject: [QUOTE_VERSION_REPOSITORY, UNIT_OF_WORK, ID_GENERATOR, CLOCK],
    },
    {
      provide: LIST_OUTBOX,
      useFactory: (outbox: OutboxRepository): ListOutbox =>
        new ListOutbox(outbox),
      inject: [OUTBOX_REPOSITORY],
    },
    OwnerSeeder,
    SessionGuard,
    IngressGuard,
  ],
})
export class ApiModule {}

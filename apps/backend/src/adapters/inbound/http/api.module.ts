import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
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
  PASSWORD_HASHER,
  type PasswordHasher,
} from "../../../core/ports/password-hasher";
import {
  PROCESSING_REVISION_REPOSITORY,
  type ProcessingRevisionRepository,
} from "../../../core/ports/processing-revision-repository";
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from "../../../core/ports/session-repository";
import {
  TOKEN_HASHER,
  type TokenHasher,
} from "../../../core/ports/token-hasher";
import {
  AUTHENTICATE_SESSION,
  AuthenticateSession,
  type AuthenticateSessionDeps,
} from "../../../core/use-cases/authenticate-session";
import { GET_THREAD, GetThread } from "../../../core/use-cases/get-thread";
import { LIST_INBOX, ListInbox } from "../../../core/use-cases/list-inbox";
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
  RETRY_MESSAGE_PROCESSING,
  RetryMessageProcessing,
} from "../../../core/use-cases/retry-message-processing";
import {
  SEED_OWNER,
  SeedOwner,
  type SeedOwnerDeps,
} from "../../../core/use-cases/seed-owner";
import { OwnerSeeder } from "../../../infrastructure/composition/owner-seeder";
import { AiModule } from "../../outbound/ai/ai.module";
import { ConfigModule } from "../../outbound/config-files/config.module";
import {
  PERSISTENCE_CLIENT,
  type PersistenceClient,
} from "../../outbound/persistence/client";
import { DrizzleConversationRepository } from "../../outbound/persistence/conversation-repository";
import { DrizzleMessageRepository } from "../../outbound/persistence/message-repository";
import { DrizzleOperatorCredentialRepository } from "../../outbound/persistence/operator-credential-repository";
import { PersistenceModule } from "../../outbound/persistence/persistence.module";
import { DrizzleProcessingRevisionRepository } from "../../outbound/persistence/processing-revision-repository";
import { DrizzleSessionRepository } from "../../outbound/persistence/session-repository";
import { Argon2PasswordHasher } from "../../outbound/security/argon2-password-hasher";
import {
  INGRESS_KEY_COMPARER,
  TimingSafeIngressKeyComparer,
} from "../../outbound/security/ingress-key-comparer";
import { Sha256TokenHasher } from "../../outbound/security/sha256-token-hasher";
import { SystemClock } from "../../outbound/security/system-clock";
import { UlidGenerator } from "../../outbound/security/ulid-id-generator";
import { AuthController } from "./auth.controller";
import { ErrorBodyFilter } from "./error-body.filter";
import { HealthController } from "./health.controller";
import { InboxController } from "./inbox.controller";
import { IngressController } from "./ingress.controller";
import { IngressGuard } from "./ingress.guard";
import { MessagesController } from "./messages.controller";
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
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorBodyFilter },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_HASHER, useClass: Sha256TokenHasher },
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
        revisions: ProcessingRevisionRepository,
        classifier: ClassifierPort,
        knowledgeBase: KnowledgeBaseRepository,
        ids: IdGenerator,
        clock: Clock,
      ): ProcessInboundMessage =>
        new ProcessInboundMessage({
          messages,
          revisions,
          classifier,
          knowledgeBase,
          ids,
          clock,
        }),
      inject: [
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
        CLASSIFIER_PORT,
        KNOWLEDGE_BASE_REPOSITORY,
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
      ): GetThread => new GetThread({ conversations, messages, revisions }),
      inject: [
        CONVERSATION_REPOSITORY,
        MESSAGE_REPOSITORY,
        PROCESSING_REVISION_REPOSITORY,
      ],
    },
    OwnerSeeder,
    SessionGuard,
    IngressGuard,
  ],
})
export class ApiModule {}

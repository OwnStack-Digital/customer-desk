import type { Provider } from "@nestjs/common";
import {
  AUDIT_EVENT_REPOSITORY,
  type AuditEventRepository,
} from "../../../core/ports/audit-event-repository";
import { CLOCK, type Clock } from "../../../core/ports/clock";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../../../core/ports/conversation-repository";
import {
  DRAFT_REVISION_REPOSITORY,
  type DraftRevisionRepository,
} from "../../../core/ports/draft-revision-repository";
import {
  ID_GENERATOR,
  type IdGenerator,
} from "../../../core/ports/id-generator";
import {
  MESSAGE_REPOSITORY,
  type MessageRepository,
} from "../../../core/ports/message-repository";
import {
  ORGANIZATION_PROFILE_REPOSITORY,
  type OrganizationProfileRepository,
} from "../../../core/ports/organization-profile-repository";
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from "../../../core/ports/outbox-repository";
import {
  PROCESSING_REVISION_REPOSITORY,
  type ProcessingRevisionRepository,
} from "../../../core/ports/processing-revision-repository";
import {
  QUOTE_VERSION_REPOSITORY,
  type QuoteVersionRepository,
} from "../../../core/ports/quote-version-repository";
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
import { GET_THREAD, GetThread } from "../../../core/use-cases/get-thread";
import { LIST_INBOX, ListInbox } from "../../../core/use-cases/list-inbox";
import { LIST_OUTBOX, ListOutbox } from "../../../core/use-cases/list-outbox";
import {
  REVIEW_DRAFT,
  ReviewDraft,
} from "../../../core/use-cases/review-draft";
import {
  SEND_APPROVED_DRAFT,
  SendApprovedDraft,
} from "../../../core/use-cases/send-approved-draft";
import {
  TAKE_OVER_CONVERSATION,
  TakeOverConversation,
} from "../../../core/use-cases/take-over-conversation";

export const ownerProviders: Provider[] = [
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
    provide: LIST_OUTBOX,
    useFactory: (outbox: OutboxRepository): ListOutbox =>
      new ListOutbox(outbox),
    inject: [OUTBOX_REPOSITORY],
  },
];

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
import { DRAFTER_PORT, type DrafterPort } from "../../../core/ports/drafter";
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
  GET_THREAD,
  GetThread,
} from "../../../core/use-cases/inbox/get-thread";
import {
  LIST_INBOX,
  ListInbox,
} from "../../../core/use-cases/inbox/list-inbox";
import {
  PROCESS_INBOUND_MESSAGE,
  type ProcessInboundMessage,
} from "../../../core/use-cases/ingress/process-inbound-message";
import {
  GET_PRICE_CATALOG,
  GetPriceCatalog,
} from "../../../core/use-cases/quotes/get-price-catalog";
import {
  REVISE_DECLINED_QUOTE,
  ReviseDeclinedQuote,
} from "../../../core/use-cases/quotes/revise-declined-quote";
import {
  INSTRUCT_ASSISTANT,
  InstructAssistant,
} from "../../../core/use-cases/review/instruct-assistant";
import {
  LIST_OUTBOX,
  ListOutbox,
} from "../../../core/use-cases/review/list-outbox";
import {
  RECEIVE_CUSTOMER_REPLY,
  ReceiveCustomerReply,
} from "../../../core/use-cases/review/receive-customer-reply";
import {
  REVIEW_DRAFT,
  ReviewDraft,
} from "../../../core/use-cases/review/review-draft";
import {
  SEND_APPROVED_DRAFT,
  SendApprovedDraft,
} from "../../../core/use-cases/review/send-approved-draft";
import {
  SEND_OPERATOR_MESSAGE,
  SendOperatorMessage,
} from "../../../core/use-cases/review/send-operator-message";
import {
  TAKE_OVER_CONVERSATION,
  TakeOverConversation,
} from "../../../core/use-cases/review/take-over-conversation";

export const ownerProviders: Provider[] = [
  {
    provide: LIST_INBOX,
    useFactory: (
      conversations: ConversationRepository,
      messages: MessageRepository,
      revisions: ProcessingRevisionRepository,
      quotes: QuoteVersionRepository,
    ): ListInbox =>
      new ListInbox({ conversations, messages, revisions, quotes }),
    inject: [
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      PROCESSING_REVISION_REPOSITORY,
      QUOTE_VERSION_REPOSITORY,
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
      audit: AuditEventRepository,
    ): GetThread =>
      new GetThread({
        conversations,
        messages,
        revisions,
        drafts,
        quotes,
        audit,
      }),
    inject: [
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      PROCESSING_REVISION_REPOSITORY,
      DRAFT_REVISION_REPOSITORY,
      QUOTE_VERSION_REPOSITORY,
      AUDIT_EVENT_REPOSITORY,
    ],
  },
  {
    provide: REVIEW_DRAFT,
    useFactory: (
      drafts: DraftRevisionRepository,
      quotes: QuoteVersionRepository,
      audit: AuditEventRepository,
      ids: IdGenerator,
      clock: Clock,
    ): ReviewDraft => new ReviewDraft({ drafts, quotes, audit, ids, clock }),
    inject: [
      DRAFT_REVISION_REPOSITORY,
      QUOTE_VERSION_REPOSITORY,
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
    provide: GET_PRICE_CATALOG,
    useFactory: (priceList: PriceListRepository): GetPriceCatalog =>
      new GetPriceCatalog(priceList),
    inject: [PRICE_LIST_REPOSITORY],
  },
  {
    provide: REVISE_DECLINED_QUOTE,
    useFactory: (
      conversations: ConversationRepository,
      quotes: QuoteVersionRepository,
      drafts: DraftRevisionRepository,
      messages: MessageRepository,
      priceList: PriceListRepository,
      profile: OrganizationProfileRepository,
      drafter: DrafterPort,
      unitOfWork: UnitOfWork,
      ids: IdGenerator,
      clock: Clock,
    ): ReviseDeclinedQuote =>
      new ReviseDeclinedQuote({
        conversations,
        quotes,
        drafts,
        messages,
        priceList,
        profile,
        drafter,
        unitOfWork,
        ids,
        clock,
      }),
    inject: [
      CONVERSATION_REPOSITORY,
      QUOTE_VERSION_REPOSITORY,
      DRAFT_REVISION_REPOSITORY,
      MESSAGE_REPOSITORY,
      PRICE_LIST_REPOSITORY,
      ORGANIZATION_PROFILE_REPOSITORY,
      DRAFTER_PORT,
      UNIT_OF_WORK,
      ID_GENERATOR,
      CLOCK,
    ],
  },
  {
    provide: SEND_OPERATOR_MESSAGE,
    useFactory: (
      conversations: ConversationRepository,
      messages: MessageRepository,
      profile: OrganizationProfileRepository,
      unitOfWork: UnitOfWork,
      ids: IdGenerator,
      clock: Clock,
    ): SendOperatorMessage =>
      new SendOperatorMessage({
        conversations,
        messages,
        profile,
        unitOfWork,
        ids,
        clock,
      }),
    inject: [
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      ORGANIZATION_PROFILE_REPOSITORY,
      UNIT_OF_WORK,
      ID_GENERATOR,
      CLOCK,
    ],
  },
  {
    provide: RECEIVE_CUSTOMER_REPLY,
    useFactory: (
      conversations: ConversationRepository,
      messages: MessageRepository,
      profile: OrganizationProfileRepository,
      unitOfWork: UnitOfWork,
      processing: ProcessInboundMessage,
      ids: IdGenerator,
      clock: Clock,
    ): ReceiveCustomerReply =>
      new ReceiveCustomerReply({
        conversations,
        messages,
        profile,
        unitOfWork,
        processing,
        ids,
        clock,
      }),
    inject: [
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      ORGANIZATION_PROFILE_REPOSITORY,
      UNIT_OF_WORK,
      PROCESS_INBOUND_MESSAGE,
      ID_GENERATOR,
      CLOCK,
    ],
  },
  {
    provide: INSTRUCT_ASSISTANT,
    useFactory: (
      conversations: ConversationRepository,
      messages: MessageRepository,
      profile: OrganizationProfileRepository,
      unitOfWork: UnitOfWork,
      processing: ProcessInboundMessage,
      ids: IdGenerator,
      clock: Clock,
    ): InstructAssistant =>
      new InstructAssistant({
        conversations,
        messages,
        profile,
        unitOfWork,
        processing,
        ids,
        clock,
      }),
    inject: [
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      ORGANIZATION_PROFILE_REPOSITORY,
      UNIT_OF_WORK,
      PROCESS_INBOUND_MESSAGE,
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

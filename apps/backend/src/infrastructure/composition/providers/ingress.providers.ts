import type { Provider } from "@nestjs/common";
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
  ORGANIZATION_PROFILE_REPOSITORY,
  type OrganizationProfileRepository,
} from "../../../core/ports/organization-profile-repository";
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

export const ingressUseCaseProviders: Provider[] = [
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
];

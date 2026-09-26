import type { Provider } from "@nestjs/common";
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
  MESSAGE_REPOSITORY,
  type MessageRepository,
} from "../../../core/ports/message-repository";
import {
  ORGANIZATION_PROFILE_REPOSITORY,
  type OrganizationProfileRepository,
} from "../../../core/ports/organization-profile-repository";
import {
  QUOTE_VERSION_REPOSITORY,
  type QuoteVersionRepository,
} from "../../../core/ports/quote-version-repository";
import {
  TOKEN_HASHER,
  type TokenHasher,
} from "../../../core/ports/token-hasher";
import {
  UNIT_OF_WORK,
  type UnitOfWork,
} from "../../../core/ports/unit-of-work";
import {
  CONFIRM_QUOTE_DECISION,
  ConfirmQuoteDecision,
} from "../../../core/use-cases/confirm-quote-decision";
import {
  PROCESS_INBOUND_MESSAGE,
  type ProcessInboundMessage,
} from "../../../core/use-cases/process-inbound-message";
import {
  RECORD_CUSTOMER_MESSAGE,
  RecordCustomerMessage,
} from "../../../core/use-cases/record-customer-message";
import {
  GET_PUBLIC_QUOTE,
  GetPublicQuote,
  RECORD_QUOTE_DECISION,
  RecordQuoteDecision,
} from "../../../core/use-cases/record-quote-decision";

export const quotesProviders: Provider[] = [
  {
    provide: GET_PUBLIC_QUOTE,
    useFactory: (
      quotes: QuoteVersionRepository,
      tokenHasher: TokenHasher,
      profile: OrganizationProfileRepository,
      clock: Clock,
      conversations: ConversationRepository,
      messages: MessageRepository,
    ): GetPublicQuote =>
      new GetPublicQuote({
        quotes,
        tokenHasher,
        profile,
        clock,
        conversations,
        messages,
      }),
    inject: [
      QUOTE_VERSION_REPOSITORY,
      TOKEN_HASHER,
      ORGANIZATION_PROFILE_REPOSITORY,
      CLOCK,
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
    ],
  },
  {
    provide: RECORD_CUSTOMER_MESSAGE,
    useFactory: (
      quotes: QuoteVersionRepository,
      tokenHasher: TokenHasher,
      profile: OrganizationProfileRepository,
      conversations: ConversationRepository,
      messages: MessageRepository,
      unitOfWork: UnitOfWork,
      processing: ProcessInboundMessage,
      ids: IdGenerator,
      clock: Clock,
    ): RecordCustomerMessage =>
      new RecordCustomerMessage({
        quotes,
        tokenHasher,
        profile,
        conversations,
        messages,
        unitOfWork,
        processing,
        ids,
        clock,
      }),
    inject: [
      QUOTE_VERSION_REPOSITORY,
      TOKEN_HASHER,
      ORGANIZATION_PROFILE_REPOSITORY,
      CONVERSATION_REPOSITORY,
      MESSAGE_REPOSITORY,
      UNIT_OF_WORK,
      PROCESS_INBOUND_MESSAGE,
      ID_GENERATOR,
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
];

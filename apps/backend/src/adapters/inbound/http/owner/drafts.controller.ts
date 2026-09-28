import {
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { QuoteRequestLine } from "../../../../core/domain/pricing";
import {
  CONFIRM_QUOTE_DECISION,
  type ConfirmQuoteDecision,
  type ConfirmQuoteDecisionOutcome,
} from "../../../../core/use-cases/quotes/confirm-quote-decision";
import {
  REVISE_DECLINED_QUOTE,
  type ReviseDeclinedQuote,
  type ReviseDeclinedQuoteOutcome,
} from "../../../../core/use-cases/quotes/revise-declined-quote";
import {
  type AssistantInstruction,
  INSTRUCT_ASSISTANT,
  type InstructAssistant,
} from "../../../../core/use-cases/review/instruct-assistant";
import {
  RECEIVE_CUSTOMER_REPLY,
  type ReceiveCustomerReply,
  type ReceivedCustomerReply,
} from "../../../../core/use-cases/review/receive-customer-reply";
import {
  REVIEW_DRAFT,
  type ReviewDraft,
  type ReviewDraftAction,
  type ReviewedDraft,
} from "../../../../core/use-cases/review/review-draft";
import {
  SEND_OPERATOR_MESSAGE,
  type SendOperatorMessage,
  type SentOperatorMessage,
} from "../../../../core/use-cases/review/send-operator-message";
import {
  TAKE_OVER_CONVERSATION,
  type TakeOverConversation,
} from "../../../../core/use-cases/review/take-over-conversation";
import { CONFIG } from "../../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../../outbound/config-files/loader";
import { validationError } from "../shared/http-error";
import {
  type OperatorRequest,
  operatorEmailOf,
  SessionGuard,
} from "../shared/session.guard";

interface DraftActionBody {
  action?: unknown;
  bodyText?: unknown;
}

interface QuoteDecisionBody {
  quoteVersionId?: unknown;
  decision?: unknown;
}

interface OperatorMessageBody {
  text?: unknown;
}

interface ReviseQuoteBody {
  lines?: unknown;
}

/**
 * Owner thread routes (PLAN.md slices 5 and 7):
 * `POST /threads/:conversationId/drafts/:revisionId` with
 * `{ action: "edit" | "approve" | "discard" }`,
 * `POST /threads/:conversationId/take-over`, and
 * `POST /threads/:conversationId/quote-decision` with
 * `{ quoteVersionId, decision: "accept" | "decline" }` — the operator-side
 * confirmation of a quote-reply email. An unknown revision (or a revision
 * of another conversation) is 404; a malformed action is 422; acting on a
 * stale revision is 409 `stale_revision`. Quote decisions: unknown version
 * 404, not-the-open-sent-quote 409, already-decided-differently 409.
 *
 * Carried note 14: every audit-writing action passes the operator email the
 * session guard resolved — never a generic "operator" string.
 */
@Controller("threads")
export class DraftsController {
  private readonly review: ReviewDraft;
  private readonly takeOverUseCase: TakeOverConversation;
  private readonly confirmQuoteDecision: ConfirmQuoteDecision;
  private readonly sendOperatorMessage: SendOperatorMessage;
  private readonly instructAssistant: InstructAssistant;
  private readonly receiveCustomerReply: ReceiveCustomerReply;
  private readonly reviseDeclinedQuote: ReviseDeclinedQuote;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(REVIEW_DRAFT) review: ReviewDraft,
    @Inject(TAKE_OVER_CONVERSATION) takeOverUseCase: TakeOverConversation,
    @Inject(CONFIRM_QUOTE_DECISION)
    confirmQuoteDecision: ConfirmQuoteDecision,
    @Inject(SEND_OPERATOR_MESSAGE) sendOperatorMessage: SendOperatorMessage,
    @Inject(INSTRUCT_ASSISTANT) instructAssistant: InstructAssistant,
    @Inject(RECEIVE_CUSTOMER_REPLY)
    receiveCustomerReply: ReceiveCustomerReply,
    @Inject(REVISE_DECLINED_QUOTE) reviseDeclinedQuote: ReviseDeclinedQuote,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.review = review;
    this.takeOverUseCase = takeOverUseCase;
    this.confirmQuoteDecision = confirmQuoteDecision;
    this.sendOperatorMessage = sendOperatorMessage;
    this.instructAssistant = instructAssistant;
    this.receiveCustomerReply = receiveCustomerReply;
    this.reviseDeclinedQuote = reviseDeclinedQuote;
    this.config = config;
  }

  @Post(":conversationId/drafts/:revisionId")
  @UseGuards(SessionGuard)
  async reviewDraft(
    @Param("conversationId") conversationId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: DraftActionBody,
    @Req() request: OperatorRequest,
  ): Promise<ReviewedDraft> {
    const action = parseAction(body);
    const reviewed = await this.review.run(
      this.config.organization.id,
      conversationId,
      revisionId,
      action,
      operatorEmailOf(request),
    );
    if (!reviewed) {
      throw new NotFoundException("No draft revision with that id.");
    }
    return reviewed;
  }

  @Post(":conversationId/take-over")
  @UseGuards(SessionGuard)
  async takeOver(
    @Param("conversationId") conversationId: string,
    @Req() request: OperatorRequest,
  ): Promise<{ automationPaused: true }> {
    const paused = await this.takeOverUseCase.run(
      this.config.organization.id,
      conversationId,
      operatorEmailOf(request),
    );
    if (paused === undefined) {
      throw new NotFoundException("No conversation with that id.");
    }
    return { automationPaused: true };
  }

  @Post(":conversationId/quote-decision")
  @UseGuards(SessionGuard)
  async quoteDecision(
    @Param("conversationId") conversationId: string,
    @Body() body: QuoteDecisionBody,
    @Req() request: OperatorRequest,
  ): Promise<ConfirmQuoteDecisionOutcome> {
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.quoteVersionId !== "string" ||
      body.quoteVersionId === ""
    ) {
      throw validationError("quoteVersionId is required in the body.");
    }
    if (body.decision !== "accept" && body.decision !== "decline") {
      throw validationError('decision must be "accept" or "decline".');
    }
    const outcome = await this.confirmQuoteDecision.run(
      this.config.organization.id,
      conversationId,
      body.quoteVersionId,
      body.decision,
      operatorEmailOf(request),
    );
    if (outcome.kind === "unknown") {
      throw new NotFoundException("No quote version with that id.");
    }
    return outcome;
  }

  @Post(":conversationId/messages")
  @UseGuards(SessionGuard)
  async sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: OperatorMessageBody,
    @Req() request: OperatorRequest,
  ): Promise<SentOperatorMessage> {
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.text !== "string"
    ) {
      throw validationError("text is required in the body.");
    }
    const sent = await this.sendOperatorMessage.run(
      this.config.organization.id,
      conversationId,
      body.text,
      operatorEmailOf(request),
    );
    if (!sent) {
      throw new NotFoundException("No conversation with that id.");
    }
    return sent;
  }

  @Post(":conversationId/instructions")
  @UseGuards(SessionGuard)
  async instruct(
    @Param("conversationId") conversationId: string,
    @Body() body: OperatorMessageBody,
    @Req() request: OperatorRequest,
  ): Promise<AssistantInstruction> {
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.text !== "string"
    ) {
      throw validationError("text is required in the body.");
    }
    const instructed = await this.instructAssistant.run(
      this.config.organization.id,
      conversationId,
      body.text,
      operatorEmailOf(request),
    );
    if (!instructed) {
      throw new NotFoundException("No conversation with that id.");
    }
    return instructed;
  }

  @Post(":conversationId/customer-messages")
  @UseGuards(SessionGuard)
  async receiveCustomerMessage(
    @Param("conversationId") conversationId: string,
    @Body() body: OperatorMessageBody,
    @Req() request: OperatorRequest,
  ): Promise<ReceivedCustomerReply> {
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.text !== "string"
    ) {
      throw validationError("text is required in the body.");
    }
    const received = await this.receiveCustomerReply.run(
      this.config.organization.id,
      conversationId,
      body.text,
      operatorEmailOf(request),
    );
    if (!received) {
      throw new NotFoundException("No conversation with that id.");
    }
    return received;
  }

  @Post(":conversationId/quote-revision")
  @UseGuards(SessionGuard)
  async reviseQuote(
    @Param("conversationId") conversationId: string,
    @Body() body: ReviseQuoteBody,
    @Req() request: OperatorRequest,
  ): Promise<ReviseDeclinedQuoteOutcome> {
    const lines = parseQuoteLines(body);
    const outcome = await this.reviseDeclinedQuote.run(
      this.config.organization.id,
      conversationId,
      lines,
      operatorEmailOf(request),
    );
    if (outcome.kind === "unknown") {
      throw new NotFoundException("No conversation with that id.");
    }
    return outcome;
  }
}

function parseAction(body: DraftActionBody): ReviewDraftAction {
  if (body === null || typeof body !== "object" || !body) {
    throw validationError("A draft action is required.");
  }
  if (body.action === "approve" || body.action === "discard") {
    return { action: body.action };
  }
  if (body.action === "edit") {
    if (typeof body.bodyText !== "string" || body.bodyText.trim() === "") {
      throw validationError(
        'The "edit" action requires a non-empty "bodyText".',
      );
    }
    return { action: "edit", bodyText: body.bodyText };
  }
  throw validationError('action must be "edit", "approve", or "discard".');
}

function parseQuoteLines(body: ReviseQuoteBody): QuoteRequestLine[] {
  if (body === null || typeof body !== "object" || !Array.isArray(body.lines)) {
    throw validationError("lines is required in the body.");
  }
  if (body.lines.length === 0) {
    throw validationError("Select at least one price-list item.");
  }
  return body.lines.map((line) => {
    if (line === null || typeof line !== "object") {
      throw validationError("Each line needs a label.");
    }
    const record = line as {
      ruleId?: unknown;
      label?: unknown;
      quantity?: unknown;
    };
    if (typeof record.label !== "string" || record.label.trim() === "") {
      throw validationError("Each line needs a label.");
    }
    const parsed: {
      ruleId?: string;
      label: string;
      quantity?: number;
    } = { label: record.label };
    if (typeof record.ruleId === "string" && record.ruleId !== "") {
      parsed.ruleId = record.ruleId;
    }
    if (record.quantity !== undefined) {
      if (
        typeof record.quantity !== "number" ||
        !Number.isInteger(record.quantity) ||
        record.quantity < 1
      ) {
        throw validationError("quantity must be a positive whole number.");
      }
      parsed.quantity = record.quantity;
    }
    return parsed;
  });
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { QuoteDecision } from "../../../core/domain/quote";
import {
  GET_PUBLIC_QUOTE,
  type GetPublicQuote,
  RECORD_QUOTE_DECISION,
  type RecordQuoteDecision,
} from "../../../core/use-cases/record-quote-decision";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { validationError } from "./http-error";

interface DecisionBody {
  decision?: unknown;
}

/**
 * Public quote routes (PLAN.md task 6.5): `GET /public/quotes/:token` is
 * display-only — a scanner must not be able to decide — and
 * `POST /public/quotes/:token/decision` records the explicit customer
 * decision. No session, no CORS: the unguessable token is the only
 * credential. Unknown/expired/superseded tokens are 404 on both routes;
 * an invalid decision value is 422; a conflicting decision is 409 via
 * the shared error filter. The raw token is never logged anywhere.
 */
@Controller("public/quotes")
export class PublicQuotesController {
  private readonly getQuote: GetPublicQuote;
  private readonly decide: RecordQuoteDecision;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(GET_PUBLIC_QUOTE) getQuote: GetPublicQuote,
    @Inject(RECORD_QUOTE_DECISION) decide: RecordQuoteDecision,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.getQuote = getQuote;
    this.decide = decide;
    this.config = config;
  }

  @Get(":token")
  async getPublicQuote(
    @Param("token") token: string,
  ): Promise<Awaited<ReturnType<GetPublicQuote["run"]>>> {
    const quote = await this.getQuote.run(this.config.organization.id, token);
    if (!quote) {
      throw new NotFoundException("No quote found for this link.");
    }
    return quote;
  }

  @Post(":token/decision")
  @HttpCode(200)
  async decideQuote(
    @Param("token") token: string,
    @Body() body: DecisionBody,
  ): Promise<Awaited<ReturnType<RecordQuoteDecision["run"]>>> {
    if (
      body === null ||
      typeof body !== "object" ||
      (body.decision !== "accept" && body.decision !== "decline")
    ) {
      throw validationError('decision must be "accept" or "decline".');
    }
    const decision: QuoteDecision = body.decision;
    const quote = await this.decide.run(
      this.config.organization.id,
      token,
      decision,
    );
    if (!quote) {
      throw new NotFoundException("No quote found for this link.");
    }
    return quote;
  }
}

import {
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  SEND_APPROVED_DRAFT,
  type SendApprovedDraft,
  type SendResult,
} from "../../../core/use-cases/send-approved-draft";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { validationError } from "./http-error";
import { SessionGuard } from "./session.guard";

/** The session guard authenticates an operator; audit rows name it. */
const OPERATOR_ACTOR = "operator";

interface SendBody {
  revisionId?: unknown;
}

/**
 * `POST /drafts/:revisionId/send` (PLAN.md slice 5). The redundant path id
 * must match the body `revisionId` (else 422). Sending an approved,
 * not-yet-consumed revision is 200 with the outbound message; a replay of
 * a consumed revision returns the **same** message (idempotent 200);
 * anything not approved is 409 `conflict`; an unknown id is 404.
 */
@Controller("drafts")
export class SendController {
  private readonly send: SendApprovedDraft;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(SEND_APPROVED_DRAFT) send: SendApprovedDraft,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.send = send;
    this.config = config;
  }

  @Post(":revisionId/send")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async sendDraft(
    @Param("revisionId") revisionId: string,
    @Body() body: SendBody,
  ): Promise<SendResult> {
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.revisionId !== "string"
    ) {
      throw validationError("revisionId is required in the body.");
    }
    if (body.revisionId !== revisionId) {
      throw validationError(
        "The path revisionId and the body revisionId must match.",
      );
    }
    const result = await this.send.run(
      this.config.organization.id,
      revisionId,
      OPERATOR_ACTOR,
    );
    if (!result) {
      throw new NotFoundException("No draft revision with that id.");
    }
    return result;
  }
}

import {
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  REVIEW_DRAFT,
  type ReviewDraft,
  type ReviewDraftAction,
  type ReviewedDraft,
} from "../../../core/use-cases/review-draft";
import {
  TAKE_OVER_CONVERSATION,
  type TakeOverConversation,
} from "../../../core/use-cases/take-over-conversation";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { validationError } from "./http-error";
import { SessionGuard } from "./session.guard";

/** The session guard authenticates an operator; audit rows name it. */
const OPERATOR_ACTOR = "operator";

interface DraftActionBody {
  action?: unknown;
  bodyText?: unknown;
}

/**
 * Owner draft-review and take-over routes (PLAN.md slice 5):
 * `POST /threads/:conversationId/drafts/:revisionId` with
 * `{ action: "edit" | "approve" | "discard" }` and
 * `POST /threads/:conversationId/take-over`. An unknown revision (or a
 * revision of another conversation) is 404; a malformed action is 422;
 * acting on a stale revision is 409 `stale_revision`.
 */
@Controller("threads")
export class DraftsController {
  private readonly review: ReviewDraft;
  private readonly takeOverUseCase: TakeOverConversation;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(REVIEW_DRAFT) review: ReviewDraft,
    @Inject(TAKE_OVER_CONVERSATION) takeOverUseCase: TakeOverConversation,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.review = review;
    this.takeOverUseCase = takeOverUseCase;
    this.config = config;
  }

  @Post(":conversationId/drafts/:revisionId")
  @UseGuards(SessionGuard)
  async reviewDraft(
    @Param("conversationId") conversationId: string,
    @Param("revisionId") revisionId: string,
    @Body() body: DraftActionBody,
  ): Promise<ReviewedDraft> {
    const action = parseAction(body);
    const reviewed = await this.review.run(
      this.config.organization.id,
      conversationId,
      revisionId,
      action,
      OPERATOR_ACTOR,
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
  ): Promise<{ automationPaused: true }> {
    const paused = await this.takeOverUseCase.run(
      this.config.organization.id,
      conversationId,
      OPERATOR_ACTOR,
    );
    if (paused === undefined) {
      throw new NotFoundException("No conversation with that id.");
    }
    return { automationPaused: true };
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

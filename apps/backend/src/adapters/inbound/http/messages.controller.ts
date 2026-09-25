import {
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { ProcessingResult } from "../../../core/domain/processing";
import {
  RETRY_MESSAGE_PROCESSING,
  type RetryMessageProcessing,
} from "../../../core/use-cases/retry-message-processing";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { SessionGuard } from "./session.guard";

/**
 * Owner message actions. `POST /messages/:messageId/retry-processing`
 * appends a new processing revision (PLAN.md task 3.5); it never deletes
 * or mutates the message and requires the session cookie.
 */
@Controller("messages")
export class MessagesController {
  private readonly retry: RetryMessageProcessing;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(RETRY_MESSAGE_PROCESSING) retry: RetryMessageProcessing,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.retry = retry;
    this.config = config;
  }

  @Post(":messageId/retry-processing")
  @UseGuards(SessionGuard)
  async retryProcessing(
    @Param("messageId") messageId: string,
  ): Promise<ProcessingResult> {
    const result = await this.retry.run(this.config.organization.id, messageId);
    if (!result) {
      throw new NotFoundException("No message with that id.");
    }
    return result;
  }
}

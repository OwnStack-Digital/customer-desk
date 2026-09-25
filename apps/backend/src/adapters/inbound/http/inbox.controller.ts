import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  UseGuards,
} from "@nestjs/common";
import { GET_THREAD, type GetThread } from "../../../core/use-cases/get-thread";
import { LIST_INBOX, type ListInbox } from "../../../core/use-cases/list-inbox";
import { CONFIG } from "../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../outbound/config-files/loader";
import { SessionGuard } from "./session.guard";

/**
 * Owner reads: `GET /inbox` lists conversations newest activity first;
 * `GET /threads/:conversationId` returns one conversation with its plain
 * text messages (HTML is stored but never returned). Both require the
 * session cookie.
 */
@Controller()
export class InboxController {
  private readonly listInbox: ListInbox;
  private readonly threads: GetThread;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(LIST_INBOX) listInbox: ListInbox,
    @Inject(GET_THREAD) getThread: GetThread,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.listInbox = listInbox;
    this.threads = getThread;
    this.config = config;
  }

  @Get("inbox")
  @UseGuards(SessionGuard)
  getInbox() {
    return this.listInbox.run(this.config.organization.id);
  }

  @Get("threads/:conversationId")
  @UseGuards(SessionGuard)
  async getThread(
    @Param("conversationId") conversationId: string,
  ): Promise<ReturnType<GetThread["run"]>> {
    const thread = await this.threads.run(
      this.config.organization.id,
      conversationId,
    );
    if (!thread) {
      throw new NotFoundException("No conversation with that id.");
    }
    return thread;
  }
}

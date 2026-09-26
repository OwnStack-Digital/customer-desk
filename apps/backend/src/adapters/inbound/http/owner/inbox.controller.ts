import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { InboxFilter } from "../../../../core/domain/messaging";
import {
  GET_THREAD,
  type GetThread,
} from "../../../../core/use-cases/get-thread";
import {
  LIST_INBOX,
  type ListInbox,
} from "../../../../core/use-cases/list-inbox";
import { CONFIG } from "../../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../../outbound/config-files/loader";
import { validationError } from "../shared/http-error";
import { SessionGuard } from "../shared/session.guard";

/**
 * Owner reads: `GET /inbox` lists conversations newest activity first;
 * `GET /threads/:conversationId` returns one conversation with its plain
 * text messages (HTML is stored but never returned). Both require the
 * session cookie. An unknown `filter` is 422, filtering happens in the use
 * case — never here.
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
  getInbox(@Query("filter") filter?: string) {
    if (filter !== undefined && !isInboxFilter(filter)) {
      throw validationError(
        `Unknown filter "${filter}". Use all, needs_human, or complaints.`,
      );
    }
    return this.listInbox.run(this.config.organization.id, filter ?? "all");
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

const INBOX_FILTERS: readonly InboxFilter[] = [
  "all",
  "needs_human",
  "complaints",
];

function isInboxFilter(value: string): value is InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(value);
}

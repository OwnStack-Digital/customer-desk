import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { OutboxPage } from "../../../../core/domain/outbox";
import {
  LIST_OUTBOX,
  type ListOutbox,
} from "../../../../core/use-cases/review/list-outbox";
import { CONFIG } from "../../../outbound/config-files/config.module";
import type { ValidatedConfig } from "../../../outbound/config-files/loader";
import { SessionGuard } from "../shared/session.guard";

/**
 * `GET /outbox` (PLAN.md slice 5): queued/failed/uncertain rows, newest
 * first, with the last error of each row (empty in the happy path). The
 * demonstrator has no `sent` from a provider — no route ever marks a row
 * `sent`.
 */
@Controller("outbox")
export class OutboxController {
  private readonly listOutbox: ListOutbox;
  private readonly config: ValidatedConfig;

  constructor(
    @Inject(LIST_OUTBOX) listOutbox: ListOutbox,
    @Inject(CONFIG) config: ValidatedConfig,
  ) {
    this.listOutbox = listOutbox;
    this.config = config;
  }

  @Get()
  @UseGuards(SessionGuard)
  async getOutbox(): Promise<OutboxPage> {
    return this.listOutbox.run(this.config.organization.id);
  }
}

import { Controller, Get, UseGuards } from "@nestjs/common";
import { SessionGuard } from "./session.guard";

/** Slice 1 stub: proves the session guard; slice 2 fills real items. */
@Controller()
export class InboxController {
  @Get("inbox")
  @UseGuards(SessionGuard)
  getInbox(): { items: unknown[] } {
    return { items: [] };
  }
}

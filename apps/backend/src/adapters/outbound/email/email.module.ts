import { Module } from "@nestjs/common";
import { EMAIL_SENDER_PORT } from "../../../core/ports/email-sender";
import { RecordingEmailSender } from "./recording-email-sender";

/**
 * Binds `EmailSenderPort` to the recording fake (PLAN.md task 5.5). No
 * HTTP route invokes it and nothing marks an outbox row `sent`; a
 * provider adapter lands in the pilot (slice 8).
 */
@Module({
  providers: [{ provide: EMAIL_SENDER_PORT, useClass: RecordingEmailSender }],
  exports: [EMAIL_SENDER_PORT],
})
export class EmailModule {}
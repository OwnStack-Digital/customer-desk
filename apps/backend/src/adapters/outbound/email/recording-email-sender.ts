import type {
  EmailSenderPort,
  OutboundEmail,
} from "../../../core/ports/email-sender";

/**
 * Recording fake (PLAN.md task 5.5): the demonstrator's only
 * `EmailSenderPort` binding. It never sends anything; it records what
 * *would* be submitted so tests can assert that no HTTP route invoked the
 * sender. A real provider adapter lands with the pilot delivery worker.
 */
export class RecordingEmailSender implements EmailSenderPort {
  readonly recorded: OutboundEmail[] = [];

  async send(email: OutboundEmail): Promise<void> {
    this.recorded.push({ ...email, to: [...email.to] });
  }
}

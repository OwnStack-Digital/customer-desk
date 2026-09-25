/** One customer-visible email handed to a provider (pilot). */
export interface OutboundEmail {
  readonly to: readonly string[];
  readonly subject?: string;
  readonly text: string;
}

/**
 * Provider submission port (PLAN.md slice 5). The demonstrator binds a
 * recording fake; no HTTP route ever invokes it, and nothing marks an
 * outbox row `sent` until the pilot delivery worker exists.
 */
export interface EmailSenderPort {
  send(email: OutboundEmail): Promise<void>;
}

/** DI token (composition root only; the use case itself is framework-free). */
export const EMAIL_SENDER_PORT = "EmailSenderPort";
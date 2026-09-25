import type { MailboxBinding } from "../domain/config";

/** Mailbox lookup for ingress binding. File-backed in the demonstrator. */
export interface MailboxRepository {
  getMailbox(id: string): MailboxBinding | undefined;
}

export const MAILBOX_REPOSITORY = "MailboxRepository";

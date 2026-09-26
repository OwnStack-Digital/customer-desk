import { and, eq } from "drizzle-orm";
import type {
  EmailAttachment,
  StoredMessage,
} from "../../../../../core/domain/messaging";
import type { MessageRepository } from "../../../../../core/ports/message-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgMessages, sqliteMessages } from "../../schema";

type PgRow = typeof pgMessages.$inferSelect;
type PgInsert = typeof pgMessages.$inferInsert;
type SqliteRow = typeof sqliteMessages.$inferSelect;
type SqliteInsert = typeof sqliteMessages.$inferInsert;

/**
 * Drizzle-backed message repository. JSON columns (addressing lists,
 * `references`, `attachments`) are jsonb on Postgres and text JSON on
 * SQLite, so the two dialects get explicit value/row mappers.
 */
export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly client: PersistenceClient) {}

  async insertMessage(message: StoredMessage): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite().insert(sqliteMessages).values(sqliteValues(message));
    } else {
      await this.postgres().insert(pgMessages).values(pgValues(message));
    }
  }

  async findBySourceKey(
    mailboxId: string,
    sourceMessageId: string,
  ): Promise<StoredMessage | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteMessages)
            .where(
              and(
                eq(sqliteMessages.mailboxId, mailboxId),
                eq(sqliteMessages.sourceMessageId, sourceMessageId),
                eq(sqliteMessages.direction, "inbound"),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgMessages)
            .where(
              and(
                eq(pgMessages.mailboxId, mailboxId),
                eq(pgMessages.sourceMessageId, sourceMessageId),
                eq(pgMessages.direction, "inbound"),
              ),
            );
    const row = rows[0];
    return row
      ? this.client.dialect === "sqlite"
        ? sqliteToMessage(row as SqliteRow)
        : pgToMessage(row as PgRow)
      : undefined;
  }

  /** The stored message with that id, if any (processing reads). */
  async findById(
    organizationId: string,
    messageId: string,
  ): Promise<StoredMessage | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteMessages)
            .where(
              and(
                eq(sqliteMessages.organizationId, organizationId),
                eq(sqliteMessages.id, messageId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgMessages)
            .where(
              and(
                eq(pgMessages.organizationId, organizationId),
                eq(pgMessages.id, messageId),
              ),
            );
    const row = rows[0];
    return row
      ? this.client.dialect === "sqlite"
        ? sqliteToMessage(row as SqliteRow)
        : pgToMessage(row as PgRow)
      : undefined;
  }

  async findByRfcMessageId(
    mailboxId: string,
    rfcMessageId: string,
  ): Promise<StoredMessage | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteMessages)
            .where(
              and(
                eq(sqliteMessages.mailboxId, mailboxId),
                eq(sqliteMessages.messageId, rfcMessageId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgMessages)
            .where(
              and(
                eq(pgMessages.mailboxId, mailboxId),
                eq(pgMessages.messageId, rfcMessageId),
              ),
            );
    const row = rows[0];
    return row
      ? this.client.dialect === "sqlite"
        ? sqliteToMessage(row as SqliteRow)
        : pgToMessage(row as PgRow)
      : undefined;
  }

  async findLatestPerConversation(
    organizationId: string,
  ): Promise<StoredMessage[]> {
    const messages = await this.listByOrganization(organizationId);
    // One message per conversation with the greatest `receivedAt` (ties keep
    // the greater id). Sufficient for the single-mailbox demonstrator.
    const latest = new Map<string, StoredMessage>();
    for (const message of messages) {
      const current = latest.get(message.conversationId);
      if (
        !current ||
        message.receivedAt > current.receivedAt ||
        (message.receivedAt === current.receivedAt && message.id > current.id)
      ) {
        latest.set(message.conversationId, message);
      }
    }
    return [...latest.values()];
  }

  async listByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<StoredMessage[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteMessages)
            .where(
              and(
                eq(sqliteMessages.organizationId, organizationId),
                eq(sqliteMessages.conversationId, conversationId),
              ),
            )
            .orderBy(sqliteMessages.receivedAt, sqliteMessages.id)
        : await this.postgres()
            .select()
            .from(pgMessages)
            .where(
              and(
                eq(pgMessages.organizationId, organizationId),
                eq(pgMessages.conversationId, conversationId),
              ),
            )
            .orderBy(pgMessages.receivedAt, pgMessages.id);
    return rows.map((row) =>
      this.client.dialect === "sqlite"
        ? sqliteToMessage(row as SqliteRow)
        : pgToMessage(row as PgRow),
    );
  }

  private async listByOrganization(
    organizationId: string,
  ): Promise<StoredMessage[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteMessages)
            .where(eq(sqliteMessages.organizationId, organizationId))
        : await this.postgres()
            .select()
            .from(pgMessages)
            .where(eq(pgMessages.organizationId, organizationId));
    return rows.map((row) =>
      this.client.dialect === "sqlite"
        ? sqliteToMessage(row as SqliteRow)
        : pgToMessage(row as PgRow),
    );
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}

function pgValues(message: StoredMessage): PgInsert {
  return message;
}

function pgToMessage(row: PgRow): StoredMessage {
  return {
    ...row,
    direction: row.direction as StoredMessage["direction"],
    to: row.to ?? [],
    references: row.references ?? null,
    attachments: (row.attachments ?? null) as StoredMessage["attachments"],
  };
}

function sqliteValues(message: StoredMessage): SqliteInsert {
  return {
    id: message.id,
    organizationId: message.organizationId,
    mailboxId: message.mailboxId,
    conversationId: message.conversationId,
    direction: message.direction,
    sourceMessageId: message.sourceMessageId,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references ? JSON.stringify(message.references) : null,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    to: JSON.stringify(message.to),
    cc: message.cc ? JSON.stringify(message.cc) : null,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments
      ? JSON.stringify(message.attachments)
      : null,
    receivedAt: message.receivedAt,
    sentAt: message.sentAt,
  };
}

function sqliteToMessage(row: SqliteRow): StoredMessage {
  return {
    id: row.id,
    organizationId: row.organizationId,
    mailboxId: row.mailboxId,
    conversationId: row.conversationId,
    direction: row.direction as StoredMessage["direction"],
    sourceMessageId: row.sourceMessageId,
    messageId: row.messageId,
    inReplyTo: row.inReplyTo,
    references: row.references
      ? (JSON.parse(row.references) as string[])
      : null,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    to: row.to ? (JSON.parse(row.to) as string[]) : [],
    cc: row.cc ? (JSON.parse(row.cc) as string[]) : null,
    replyTo: row.replyTo,
    subject: row.subject,
    text: row.text,
    html: row.html,
    attachments: row.attachments
      ? (JSON.parse(row.attachments) as EmailAttachment[])
      : null,
    receivedAt: row.receivedAt,
    sentAt: row.sentAt,
  };
}

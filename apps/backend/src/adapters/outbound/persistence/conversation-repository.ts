import { and, eq } from "drizzle-orm";
import type { Conversation } from "../../../core/domain/messaging";
import type { ConversationRepository } from "../../../core/ports/conversation-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "./client";
import { pgConversations, sqliteConversations } from "./schema";

/** Drizzle-backed conversation repository (see session-repository). */
export class DrizzleConversationRepository implements ConversationRepository {
  constructor(private readonly client: PersistenceClient) {}

  async insertConversation(conversation: Conversation): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite().insert(sqliteConversations).values(conversation);
    } else {
      await this.postgres().insert(pgConversations).values(conversation);
    }
  }

  async findById(
    organizationId: string,
    conversationId: string,
  ): Promise<Conversation | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteConversations)
            .where(eq(sqliteConversations.id, conversationId))
        : await this.postgres()
            .select()
            .from(pgConversations)
            .where(eq(pgConversations.id, conversationId));
    return rows.find((row) => row.organizationId === organizationId);
  }

  async listByOrganization(organizationId: string): Promise<Conversation[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteConversations)
            .where(eq(sqliteConversations.organizationId, organizationId))
        : await this.postgres()
            .select()
            .from(pgConversations)
            .where(eq(pgConversations.organizationId, organizationId));
    return rows;
  }

  async deleteById(
    organizationId: string,
    conversationId: string,
  ): Promise<void> {
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .delete(sqliteConversations)
        .where(
          and(
            eq(sqliteConversations.id, conversationId),
            eq(sqliteConversations.organizationId, organizationId),
          ),
        );
    } else {
      await this.postgres()
        .delete(pgConversations)
        .where(
          and(
            eq(pgConversations.id, conversationId),
            eq(pgConversations.organizationId, organizationId),
          ),
        );
    }
  }

  async setAutomationPaused(
    organizationId: string,
    conversationId: string,
    paused: boolean,
  ): Promise<boolean> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .update(sqliteConversations)
            .set({ automationPaused: paused })
            .where(
              and(
                eq(sqliteConversations.id, conversationId),
                eq(sqliteConversations.organizationId, organizationId),
              ),
            )
            .returning({ id: sqliteConversations.id })
        : await this.postgres()
            .update(pgConversations)
            .set({ automationPaused: paused })
            .where(
              and(
                eq(pgConversations.id, conversationId),
                eq(pgConversations.organizationId, organizationId),
              ),
            )
            .returning({ id: pgConversations.id });
    return rows.length > 0;
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}

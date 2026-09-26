import { and, eq, ne } from "drizzle-orm";
import type {
  PricedQuoteLineSnapshot,
  QuoteDecision,
  QuoteVersion,
} from "../../../../../core/domain/quote";
import type { QuoteVersionRepository } from "../../../../../core/ports/quote-version-repository";
import type { PersistenceClient, PostgresDb, SqliteDb } from "../../client";
import { pgQuoteVersions, sqliteQuoteVersions } from "../../schema";

type PgRow = typeof pgQuoteVersions.$inferSelect;
type SqliteRow = typeof sqliteQuoteVersions.$inferSelect;

/**
 * Drizzle-backed quote-version repository. `lines` and `assumptions` are
 * jsonb on Postgres and text JSON on SQLite, so the two dialects get
 * explicit value/row mappers (mirrors the draft-revision repo). Status
 * changes are conditional updates: the SQL `WHERE` clause carries the
 * expected current status, so a stale version loses the race instead of
 * being silently mutated.
 */
export class DrizzleQuoteVersionRepository implements QuoteVersionRepository {
  constructor(private readonly client: PersistenceClient) {}

  async insertQuoteVersion(quote: QuoteVersion): Promise<void> {
    const values = {
      id: quote.id,
      organizationId: quote.organizationId,
      conversationId: quote.conversationId,
      draftRevisionId: quote.draftRevisionId,
      status: quote.status,
      tokenHash: quote.tokenHash,
      currency: quote.currency,
      subtotalMinor: quote.subtotalMinor,
      taxMinor: quote.taxMinor,
      totalMinor: quote.totalMinor,
      priceListVersion: quote.priceListVersion,
      validUntil: quote.validUntil,
      sentAt: quote.sentAt,
      decidedAt: quote.decidedAt,
      decision: quote.decision,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
    if (this.client.dialect === "sqlite") {
      await this.sqlite()
        .insert(sqliteQuoteVersions)
        .values({
          ...values,
          lines: JSON.stringify(quote.lines.map((line) => ({ ...line }))),
          assumptions: JSON.stringify([...quote.assumptions]),
        });
    } else {
      await this.postgres()
        .insert(pgQuoteVersions)
        .values({
          ...values,
          lines: quote.lines.map((line) => ({ ...line })),
          assumptions: [...quote.assumptions],
        });
    }
  }

  async findById(
    organizationId: string,
    quoteVersionId: string,
  ): Promise<QuoteVersion | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                eq(sqliteQuoteVersions.id, quoteVersionId),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                eq(pgQuoteVersions.id, quoteVersionId),
              ),
            );
    return rows[0] ? this.toQuote(rows[0]) : undefined;
  }

  async findByTokenHash(
    organizationId: string,
    tokenHash: string,
  ): Promise<QuoteVersion | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                eq(sqliteQuoteVersions.tokenHash, tokenHash),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                eq(pgQuoteVersions.tokenHash, tokenHash),
              ),
            );
    return rows[0] ? this.toQuote(rows[0]) : undefined;
  }

  async findLatestVisibleByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<QuoteVersion | undefined> {
    return newestOf(await this.listVisible(organizationId, conversationId));
  }

  async findLatestVisiblePerConversation(
    organizationId: string,
  ): Promise<readonly QuoteVersion[]> {
    const latest = new Map<string, QuoteVersion>();
    for (const quote of await this.listVisible(organizationId)) {
      const current = latest.get(quote.conversationId);
      if (!current || isNewer(quote, current)) {
        latest.set(quote.conversationId, quote);
      }
    }
    return [...latest.values()];
  }

  async findLatestOpenByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<QuoteVersion | undefined> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                eq(sqliteQuoteVersions.conversationId, conversationId),
                // Open = still awaiting the customer's decision.
                eq(sqliteQuoteVersions.status, "prepared"),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                eq(pgQuoteVersions.conversationId, conversationId),
                eq(pgQuoteVersions.status, "prepared"),
              ),
            );
    const open = rows.map((row) => this.toQuote(row));
    if (open.length > 0) {
      return newestOf(open);
    }
    // No `prepared` version: a `sent` one is still open.
    const sent =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                eq(sqliteQuoteVersions.conversationId, conversationId),
                eq(sqliteQuoteVersions.status, "sent"),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                eq(pgQuoteVersions.conversationId, conversationId),
                eq(pgQuoteVersions.status, "sent"),
              ),
            );
    return newestOf(sent.map((row) => this.toQuote(row)));
  }

  async markSent(
    organizationId: string,
    quoteVersionId: string,
    fields: {
      readonly tokenHash: string;
      readonly sentAt: string;
      readonly validUntil: string;
      readonly updatedAt: string;
    },
  ): Promise<boolean> {
    if (this.client.dialect === "sqlite") {
      const rows = await this.sqlite()
        .update(sqliteQuoteVersions)
        .set({
          status: "sent",
          tokenHash: fields.tokenHash,
          sentAt: fields.sentAt,
          validUntil: fields.validUntil,
          updatedAt: fields.updatedAt,
        })
        .where(
          and(
            eq(sqliteQuoteVersions.organizationId, organizationId),
            eq(sqliteQuoteVersions.id, quoteVersionId),
            eq(sqliteQuoteVersions.status, "prepared"),
          ),
        )
        .returning({ id: sqliteQuoteVersions.id });
      return rows.length > 0;
    }
    const rows = await this.postgres()
      .update(pgQuoteVersions)
      .set({
        status: "sent",
        tokenHash: fields.tokenHash,
        sentAt: fields.sentAt,
        validUntil: fields.validUntil,
        updatedAt: fields.updatedAt,
      })
      .where(
        and(
          eq(pgQuoteVersions.organizationId, organizationId),
          eq(pgQuoteVersions.id, quoteVersionId),
          eq(pgQuoteVersions.status, "prepared"),
        ),
      )
      .returning({ id: pgQuoteVersions.id });
    return rows.length > 0;
  }

  async supersedeSentExcept(
    organizationId: string,
    conversationId: string,
    keepQuoteVersionId: string,
    updatedAt: string,
  ): Promise<number> {
    if (this.client.dialect === "sqlite") {
      const rows = await this.sqlite()
        .update(sqliteQuoteVersions)
        .set({ status: "superseded", updatedAt })
        .where(
          and(
            eq(sqliteQuoteVersions.organizationId, organizationId),
            eq(sqliteQuoteVersions.conversationId, conversationId),
            eq(sqliteQuoteVersions.status, "sent"),
            ne(sqliteQuoteVersions.id, keepQuoteVersionId),
          ),
        )
        .returning({ id: sqliteQuoteVersions.id });
      return rows.length;
    }
    const rows = await this.postgres()
      .update(pgQuoteVersions)
      .set({ status: "superseded", updatedAt })
      .where(
        and(
          eq(pgQuoteVersions.organizationId, organizationId),
          eq(pgQuoteVersions.conversationId, conversationId),
          eq(pgQuoteVersions.status, "sent"),
          ne(pgQuoteVersions.id, keepQuoteVersionId),
        ),
      )
      .returning({ id: pgQuoteVersions.id });
    return rows.length;
  }

  async findSentByConversation(
    organizationId: string,
    conversationId: string,
  ): Promise<readonly QuoteVersion[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                eq(sqliteQuoteVersions.conversationId, conversationId),
                eq(sqliteQuoteVersions.status, "sent"),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                eq(pgQuoteVersions.conversationId, conversationId),
                eq(pgQuoteVersions.status, "sent"),
              ),
            );
    return rows.map((row) => this.toQuote(row));
  }

  async decide(
    organizationId: string,
    quoteVersionId: string,
    decision: QuoteDecision,
    decidedAt: string,
    updatedAt: string,
  ): Promise<boolean> {
    const status = decision === "accept" ? "accepted" : "declined";
    if (this.client.dialect === "sqlite") {
      const rows = await this.sqlite()
        .update(sqliteQuoteVersions)
        .set({ status, decision, decidedAt, updatedAt })
        .where(
          and(
            eq(sqliteQuoteVersions.organizationId, organizationId),
            eq(sqliteQuoteVersions.id, quoteVersionId),
            eq(sqliteQuoteVersions.status, "sent"),
          ),
        )
        .returning({ id: sqliteQuoteVersions.id });
      return rows.length > 0;
    }
    const rows = await this.postgres()
      .update(pgQuoteVersions)
      .set({ status, decision, decidedAt, updatedAt })
      .where(
        and(
          eq(pgQuoteVersions.organizationId, organizationId),
          eq(pgQuoteVersions.id, quoteVersionId),
          eq(pgQuoteVersions.status, "sent"),
        ),
      )
      .returning({ id: pgQuoteVersions.id });
    return rows.length > 0;
  }

  /** Non-superseded versions. A conversation filter is optional so the
   * inbox can load every conversation in one query. */
  private async listVisible(
    organizationId: string,
    conversationId?: string,
  ): Promise<QuoteVersion[]> {
    const rows =
      this.client.dialect === "sqlite"
        ? await this.sqlite()
            .select()
            .from(sqliteQuoteVersions)
            .where(
              and(
                eq(sqliteQuoteVersions.organizationId, organizationId),
                ne(sqliteQuoteVersions.status, "superseded"),
                ...(conversationId
                  ? [eq(sqliteQuoteVersions.conversationId, conversationId)]
                  : []),
              ),
            )
        : await this.postgres()
            .select()
            .from(pgQuoteVersions)
            .where(
              and(
                eq(pgQuoteVersions.organizationId, organizationId),
                ne(pgQuoteVersions.status, "superseded"),
                ...(conversationId
                  ? [eq(pgQuoteVersions.conversationId, conversationId)]
                  : []),
              ),
            );
    return rows.map((row) => this.toQuote(row));
  }

  private toQuote(row: PgRow | SqliteRow): QuoteVersion {
    return {
      id: row.id,
      organizationId: row.organizationId,
      conversationId: row.conversationId,
      draftRevisionId: row.draftRevisionId,
      status: row.status as QuoteVersion["status"],
      tokenHash: row.tokenHash,
      lines: parseLines(row.lines),
      assumptions: parseStrings(row.assumptions),
      currency: row.currency,
      subtotalMinor: row.subtotalMinor,
      taxMinor: row.taxMinor,
      totalMinor: row.totalMinor,
      priceListVersion: row.priceListVersion,
      validUntil: row.validUntil,
      sentAt: row.sentAt,
      decidedAt: row.decidedAt,
      decision: (row.decision as QuoteDecision | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private sqlite(): SqliteDb {
    return this.client.open() as SqliteDb;
  }

  private postgres(): PostgresDb {
    return this.client.open() as PostgresDb;
  }
}

function parseLines(
  column: PgRow["lines"] | SqliteRow["lines"],
): PricedQuoteLineSnapshot[] {
  if (!column) {
    return [];
  }
  const parsed = typeof column === "string" ? JSON.parse(column) : column;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((line) => ({
    ruleId: String(line.ruleId),
    name: String(line.name),
    ...(line.quantity !== undefined ? { quantity: Number(line.quantity) } : {}),
    amountMinor: Number(line.amountMinor),
  }));
}

function parseStrings(
  column: PgRow["assumptions"] | SqliteRow["assumptions"],
): string[] {
  if (!column) {
    return [];
  }
  const parsed = typeof column === "string" ? JSON.parse(column) : column;
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
}

/** Newest first: same ordering the draft store uses for "latest". */
function newestOf(quotes: readonly QuoteVersion[]): QuoteVersion | undefined {
  return [...quotes]
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .at(-1);
}

function isNewer(candidate: QuoteVersion, current: QuoteVersion): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id > current.id)
  );
}

import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  pgConversations,
  pgMessages,
  pgOperatorCredentials,
  pgOperatorSessions,
  pgProcessingRevisions,
  sqliteConversations,
  sqliteMessages,
  sqliteOperatorCredentials,
  sqliteOperatorSessions,
  sqliteProcessingRevisions,
} from "./schema";

interface TableShape {
  name: string;
  columns: string[];
  primaryKeys: string[];
  indexNames: string[];
}

function pgShape(table: Parameters<typeof getTableConfig>[0]): TableShape {
  const config = getTableConfig(table);
  const uniqueNames = config.uniqueConstraints
    .map((constraint) => constraint.name)
    .filter((name): name is string => typeof name === "string");
  const indexNames = config.indexes
    .map((index) => index.config.name)
    .filter((name): name is string => typeof name === "string");
  // Postgres exposes unique constraints and unique indexes separately;
  // SQLite only has unique indexes. Compare the union so both dialects
  // must agree on every index-like name.
  const allIndexNames = [...new Set([...uniqueNames, ...indexNames])].sort();
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name).sort(),
    primaryKeys: config.columns
      .filter((column) => column.primary)
      .map((column) => column.name)
      .sort(),
    indexNames: allIndexNames,
  };
}

function sqliteShape(
  table: Parameters<typeof getSqliteTableConfig>[0],
): TableShape {
  const config = getSqliteTableConfig(table);
  const uniqueNames = config.indexes
    .filter((index) => index.config.unique)
    .map((index) => index.config.name)
    .filter((name): name is string => typeof name === "string");
  const indexNames = config.indexes
    .map((index) => index.config.name)
    .filter((name): name is string => typeof name === "string");
  const allIndexNames = [...new Set([...uniqueNames, ...indexNames])].sort();
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name).sort(),
    primaryKeys: config.columns
      .filter((column) => column.primary)
      .map((column) => column.name)
      .sort(),
    indexNames: allIndexNames,
  };
}

/** Postgres is the source of truth; SQLite must mirror it name for name. */
describe("pg/sqlite schema parity", () => {
  it("operator_credentials matches", () => {
    expect(sqliteShape(sqliteOperatorCredentials)).toEqual(
      pgShape(pgOperatorCredentials),
    );
  });

  it("operator_sessions matches", () => {
    expect(sqliteShape(sqliteOperatorSessions)).toEqual(
      pgShape(pgOperatorSessions),
    );
  });

  it("conversations matches", () => {
    expect(sqliteShape(sqliteConversations)).toEqual(pgShape(pgConversations));
  });

  it("messages matches", () => {
    expect(sqliteShape(sqliteMessages)).toEqual(pgShape(pgMessages));
  });

  it("processing_revisions matches", () => {
    expect(sqliteShape(sqliteProcessingRevisions)).toEqual(
      pgShape(pgProcessingRevisions),
    );
  });
});

import { getTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as getSqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  pgConversations,
  pgMessages,
  pgOperatorCredentials,
  pgOperatorSessions,
  sqliteConversations,
  sqliteMessages,
  sqliteOperatorCredentials,
  sqliteOperatorSessions,
} from "./schema";

interface TableShape {
  name: string;
  columns: string[];
  primaryKeys: string[];
  uniqueNames: string[];
  indexNames: string[];
}

function pgShape(table: Parameters<typeof getTableConfig>[0]): TableShape {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name).sort(),
    primaryKeys: config.columns
      .filter((column) => column.primary)
      .map((column) => column.name)
      .sort(),
    uniqueNames: config.uniqueConstraints
      .map((constraint) => constraint.name)
      .filter((name): name is string => typeof name === "string")
      .sort(),
    indexNames: config.indexes.map((index) => index.name).sort(),
  };
}

function sqliteShape(
  table: Parameters<typeof getSqliteTableConfig>[0],
): TableShape {
  const config = getSqliteTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name).sort(),
    primaryKeys: config.columns
      .filter((column) => column.primary)
      .map((column) => column.name)
      .sort(),
    uniqueNames: config.indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.name)
      .filter((name): name is string => typeof name === "string")
      .sort(),
    indexNames: config.indexes.map((index) => index.config.name).sort(),
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
});

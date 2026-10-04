import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  schemaMigrations,
  schemaStatements,
} from "./schema";

const RESOURCE_TABLES = [
  "resource_providers",
  "resource_accounts",
  "resource_items",
  "resource_sources",
  "resource_files",
  "transfer_jobs",
  "transfer_files",
  "resource_history",
  "resource_catalogs",
];

describe("Resource Core schema", () => {
  it("bumps the schema to version 11", () => {
    expect(SCHEMA_VERSION).toBe(11);
  });

  it("creates every Resource Core table for fresh databases", () => {
    for (const table of RESOURCE_TABLES) {
      expect(
        schemaStatements.some((statement) =>
          statement.includes("CREATE TABLE IF NOT EXISTS " + table),
        ),
      ).toBe(true);
    }
  });

  it("contains incremental resource migrations for existing databases", () => {
    const migration = schemaMigrations.find(
      (item) => item.version === 10,
    );

    expect(migration).toBeDefined();

    for (const table of RESOURCE_TABLES.filter(
      (table) => table !== "resource_catalogs",
    )) {
      expect(
        migration?.statements.some((statement) =>
          statement.includes("CREATE TABLE IF NOT EXISTS " + table),
        ),
      ).toBe(true);
    }

    const catalogMigration = schemaMigrations.find(
      (item) => item.version === 11,
    );
    expect(
      catalogMigration?.statements.some((statement) =>
        statement.includes(
          "CREATE TABLE IF NOT EXISTS resource_catalogs",
        ),
      ),
    ).toBe(true);
  });
});

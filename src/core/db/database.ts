import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import {
  SCHEMA_VERSION,
  schemaMigrations,
  schemaStatements,
} from "./schema";

let database: Database | null = null;

interface MetaRow {
  value: string;
}

async function readSchemaVersion(db: Database): Promise<number> {
  const rows = await db.select<MetaRow[]>(
    "SELECT value FROM app_meta WHERE key = 'schema_version' LIMIT 1",
  );
  const parsed = Number(rows[0]?.value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function runMigrations(
  db: Database,
  currentVersion: number,
): Promise<void> {
  const pending = schemaMigrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.execute("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        await db.execute(statement);
      }

      await db.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ($1, $2)",
        ["schema_version", String(migration.version)],
      );
      await db.execute("COMMIT");
    } catch (error) {
      await db.execute("ROLLBACK");
      throw error;
    }
  }
}

export async function initializeDatabase(): Promise<Database | null> {
  if (!isTauri()) {
    return null;
  }

  if (database) {
    return database;
  }

  database = await Database.load("sqlite:lexipane.db");

  await database.execute("PRAGMA foreign_keys = ON");

  for (const statement of schemaStatements) {
    await database.execute(statement);
  }

  const currentVersion = await readSchemaVersion(database);
  await runMigrations(database, currentVersion);

  await database.execute(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ($1, $2)",
    ["schema_version", String(SCHEMA_VERSION)],
  );

  return database;
}

export function getInitializedDatabase() {
  return database;
}

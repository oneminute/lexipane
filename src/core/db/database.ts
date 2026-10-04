import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import {
  SCHEMA_VERSION,
  schemaMigrations,
  schemaStatements,
} from "./schema";

let database: Database | null = null;
let databaseInitialization: Promise<Database | null> | null = null;

interface MetaRow {
  value: string;
}

interface TableRow {
  name: string;
}

const APP_META_STATEMENT =
  "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)";

async function readSchemaVersion(db: Database): Promise<number> {
  const rows = await db.select<MetaRow[]>(
    "SELECT value FROM app_meta WHERE key = 'schema_version' LIMIT 1",
  );
  const parsed = Number(rows[0]?.value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function hasExistingLibrarySchema(db: Database): Promise<boolean> {
  const rows = await db.select<TableRow[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books' LIMIT 1",
  );
  return rows.length > 0;
}

async function writeSchemaVersion(
  db: Database,
  version: number,
): Promise<void> {
  await db.execute(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ($1, $2)",
    ["schema_version", String(version)],
  );
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

      await writeSchemaVersion(db, migration.version);
      await db.execute("COMMIT");
    } catch (error) {
      await db.execute("ROLLBACK");
      throw error;
    }
  }
}

async function createLatestSchema(db: Database): Promise<void> {
  for (const statement of schemaStatements) {
    await db.execute(statement);
  }

  await writeSchemaVersion(db, SCHEMA_VERSION);
}

export async function initializeDatabase(): Promise<Database | null> {
  if (!isTauri()) {
    return null;
  }

  if (database) {
    return database;
  }

  if (databaseInitialization) {
    return databaseInitialization;
  }

  databaseInitialization = (async () => {
    const db = await Database.load("sqlite:lexipane.db");
    await db.execute("PRAGMA foreign_keys = ON");

    // app_meta must exist before any concurrent settings read can run.
    // Do not publish `database` until the entire schema initialization
    // completes; callers arriving while this work is in progress all await
    // the same initialization promise.
    await db.execute(APP_META_STATEMENT);

    const existingLibrary = await hasExistingLibrarySchema(db);

    if (!existingLibrary) {
      // A brand-new database receives the latest schema directly. Replaying
      // historical ALTER TABLE migrations here would duplicate columns that
      // are already present in the current CREATE TABLE definitions.
      await createLatestSchema(db);
    } else {
      const currentVersion = await readSchemaVersion(db);

      // CREATE IF NOT EXISTS also ensures tables introduced outside the
      // earliest schema exist before incremental migrations are applied.
      for (const statement of schemaStatements) {
        await db.execute(statement);
      }

      await runMigrations(db, currentVersion);
      await writeSchemaVersion(db, SCHEMA_VERSION);
    }

    database = db;
    return db;
  })();

  try {
    return await databaseInitialization;
  } catch (error) {
    // Allow a later call to retry cleanly after a failed initialization.
    database = null;
    throw error;
  } finally {
    databaseInitialization = null;
  }
}

export function getInitializedDatabase() {
  return database;
}

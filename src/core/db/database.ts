import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_VERSION, schemaStatements } from "./schema";

let database: Database | null = null;

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

  await database.execute(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ($1, $2)",
    ["schema_version", String(SCHEMA_VERSION)],
  );

  return database;
}

export function getInitializedDatabase() {
  return database;
}

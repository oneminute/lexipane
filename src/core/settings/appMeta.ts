import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

interface AppMetaRow {
  value: string;
}

export async function getAppMeta(key: string): Promise<string | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<AppMetaRow[]>(
    "SELECT value FROM app_meta WHERE key = $1 LIMIT 1",
    [key],
  );

  return rows[0]?.value ?? null;
}

export async function setAppMeta(
  key: string,
  value: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "INSERT INTO app_meta (key, value) VALUES ($1, $2) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import type { AiPrivacyMode } from "../ai/privacy";

export type BookPrivacyMode = AiPrivacyMode | null;

interface PrivacyRow {
  privacy_mode: string | null;
}

function parseMode(value: string | null): AiPrivacyMode | null {
  return value === "local-only" ||
    value === "prefer-local" ||
    value === "automatic" ||
    value === "cloud-only"
    ? value
    : null;
}

export async function loadBookPrivacyMode(
  path: string,
): Promise<BookPrivacyMode> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<PrivacyRow[]>(
    "SELECT privacy_mode FROM books WHERE file_path = $1 LIMIT 1",
    [path],
  );

  return parseMode(rows[0]?.privacy_mode ?? null);
}

export async function saveBookPrivacyMode(
  path: string,
  mode: BookPrivacyMode,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET privacy_mode = $2 WHERE file_path = $1",
    [path, mode],
  );
}

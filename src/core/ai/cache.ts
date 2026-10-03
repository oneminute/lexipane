import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";

interface CacheRow {
  content_json: string;
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createAiCacheKey(
  taskType: string,
  model: string,
  input: unknown,
): string {
  return [taskType, model, stableHash(JSON.stringify(input))].join(":");
}

export async function getCachedAiValue<T>(
  cacheKey: string,
): Promise<T | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<CacheRow[]>(
    "SELECT content_json FROM ai_cache WHERE cache_key = $1 LIMIT 1",
    [cacheKey],
  );

  if (!rows[0]) return null;

  try {
    return JSON.parse(rows[0].content_json) as T;
  } catch {
    return null;
  }
}

export async function putCachedAiValue(
  cacheKey: string,
  taskType: string,
  model: string,
  value: unknown,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "INSERT INTO ai_cache (cache_key, task_type, model_id, content_json, created_at) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT(cache_key) DO UPDATE SET " +
      "content_json = excluded.content_json, created_at = excluded.created_at",
    [
      cacheKey,
      taskType,
      model,
      JSON.stringify(value),
      new Date().toISOString(),
    ],
  );
}

import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import type { AiPrivacyMode } from "../ai/privacy";

export type BookPrivacyMode = AiPrivacyMode | null;

export type BookProviderPolicyMode = "all" | "allow" | "deny";

export interface BookProviderPolicy {
  mode: BookProviderPolicyMode;
  providerKeys: string[];
}

interface PrivacyRow {
  privacy_mode: string | null;
  provider_policy_json?: string | null;
}

const DEFAULT_PROVIDER_POLICY: BookProviderPolicy = {
  mode: "all",
  providerKeys: [],
};

function parseMode(value: string | null): AiPrivacyMode | null {
  return value === "local-only" ||
    value === "prefer-local" ||
    value === "automatic" ||
    value === "cloud-only"
    ? value
    : null;
}

export function normalizeBookProviderPolicy(
  value: Partial<BookProviderPolicy> | null | undefined,
): BookProviderPolicy {
  const mode =
    value?.mode === "allow" || value?.mode === "deny"
      ? value.mode
      : "all";

  const providerKeys = Array.from(
    new Set(
      (Array.isArray(value?.providerKeys) ? value.providerKeys : [])
        .filter((key): key is string => typeof key === "string")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);

  return {
    mode,
    providerKeys: mode === "all" ? [] : providerKeys,
  };
}

function parseProviderPolicy(value: string | null | undefined): BookProviderPolicy {
  if (!value) return { ...DEFAULT_PROVIDER_POLICY };

  try {
    return normalizeBookProviderPolicy(
      JSON.parse(value) as Partial<BookProviderPolicy>,
    );
  } catch {
    return { ...DEFAULT_PROVIDER_POLICY };
  }
}

async function loadBookPolicyRow(
  path: string,
): Promise<PrivacyRow | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<PrivacyRow[]>(
    "SELECT privacy_mode, provider_policy_json FROM books WHERE file_path = $1 LIMIT 1",
    [path],
  );

  return rows[0] ?? null;
}

export async function loadBookPrivacyMode(
  path: string,
): Promise<BookPrivacyMode> {
  const row = await loadBookPolicyRow(path);
  return parseMode(row?.privacy_mode ?? null);
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

export async function loadBookProviderPolicy(
  path: string,
): Promise<BookProviderPolicy> {
  const row = await loadBookPolicyRow(path);
  return parseProviderPolicy(row?.provider_policy_json);
}

export async function saveBookProviderPolicy(
  path: string,
  policy: BookProviderPolicy,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET provider_policy_json = $2 WHERE file_path = $1",
    [path, JSON.stringify(normalizeBookProviderPolicy(policy))],
  );
}

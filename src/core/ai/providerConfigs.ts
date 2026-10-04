import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import {
  deleteProviderApiKey,
  getProviderApiKey,
  hasProviderApiKey,
  setProviderApiKey,
} from "./secretStore";
import { providerCatalog } from "./registry";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OpenAICompatibleProvider } from "./providers/openAICompatible";
import type {
  ConnectionResult,
  ModelCapabilities,
  ModelInfo,
} from "./types";

interface ProviderConfigRow {
  id: string;
  provider_id: string;
  display_name: string;
  base_url: string | null;
  enabled: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderConfigSettings {
  model?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export interface ProviderConfig {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl: string;
  enabled: boolean;
  settings: ProviderConfigSettings;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveProviderConfigInput {
  id?: string;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  enabled?: boolean;
  apiKey?: string;
}

function parseSettings(value: string): ProviderConfigSettings {
  try {
    const parsed = JSON.parse(value) as ProviderConfigSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function toConfig(row: ProviderConfigRow): Promise<ProviderConfig> {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    baseUrl: row.base_url ?? "",
    enabled: row.enabled === 1,
    settings: parseSettings(row.settings_json),
    hasApiKey: await hasProviderApiKey(row.id).catch(() => false),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProviderConfigs(): Promise<ProviderConfig[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<ProviderConfigRow[]>(
    "SELECT id, provider_id, display_name, base_url, enabled, settings_json, created_at, updated_at " +
      "FROM ai_provider_configs ORDER BY updated_at DESC",
  );

  return Promise.all(rows.map(toConfig));
}

export async function getProviderConfig(
  id: string,
): Promise<ProviderConfig | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<ProviderConfigRow[]>(
    "SELECT id, provider_id, display_name, base_url, enabled, settings_json, created_at, updated_at " +
      "FROM ai_provider_configs WHERE id = $1 LIMIT 1",
    [id],
  );

  return rows[0] ? toConfig(rows[0]) : null;
}

export async function saveProviderConfig(
  input: SaveProviderConfigInput,
): Promise<ProviderConfig> {
  if (!isTauri()) {
    throw new Error("Provider configuration requires the desktop application.");
  }

  const descriptor = providerCatalog.find(
    (provider) => provider.id === input.providerId,
  );
  if (!descriptor) {
    throw new Error("Unknown provider: " + input.providerId);
  }

  if (
    descriptor.adapter !== "openai-compatible" &&
    descriptor.adapter !== "anthropic-native" &&
    descriptor.adapter !== "gemini-native"
  ) {
    throw new Error(
      descriptor.name +
        " needs its provider adapter before it can be configured here.",
    );
  }

  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Base URL is required.");
  }

  const parsedUrl = new URL(baseUrl);
  const isLoopback =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1";

  if (parsedUrl.protocol !== "https:" && !isLoopback) {
    throw new Error(
      "Cloud provider endpoints must use HTTPS. Plain HTTP is only allowed for localhost.",
    );
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable.");
  }

  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const inputCost = Number(input.inputCostPerMillion);
  const outputCost = Number(input.outputCostPerMillion);
  const settings: ProviderConfigSettings = {
    model: input.model?.trim() || undefined,
    inputCostPerMillion:
      Number.isFinite(inputCost) && inputCost >= 0
        ? inputCost
        : undefined,
    outputCostPerMillion:
      Number.isFinite(outputCost) && outputCost >= 0
        ? outputCost
        : undefined,
  };

  await db.execute(
    "INSERT INTO ai_provider_configs " +
      "(id, provider_id, display_name, base_url, enabled, settings_json, created_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $7) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "provider_id = excluded.provider_id, " +
      "display_name = excluded.display_name, " +
      "base_url = excluded.base_url, " +
      "enabled = excluded.enabled, " +
      "settings_json = excluded.settings_json, " +
      "updated_at = excluded.updated_at",
    [
      id,
      input.providerId,
      input.displayName.trim() || descriptor.name,
      baseUrl,
      input.enabled === false ? 0 : 1,
      JSON.stringify(settings),
      now,
    ],
  );

  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    await setProviderApiKey(id, apiKey);
  }

  const saved = await getProviderConfig(id);
  if (!saved) {
    throw new Error("Provider configuration was not saved.");
  }

  return saved;
}

export async function deleteProviderConfig(id: string): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "DELETE FROM ai_provider_configs WHERE id = $1",
    [id],
  );
  await deleteProviderApiKey(id).catch(() => undefined);
}

async function createRuntime(config: ProviderConfig) {
  const descriptor = providerCatalog.find(
    (provider) => provider.id === config.providerId,
  );
  if (!descriptor) {
    throw new Error("Provider is no longer registered: " + config.providerId);
  }

  const apiKey = await getProviderApiKey(config.id);
  const options = {
    descriptor,
    baseUrl: config.baseUrl,
    apiKey: apiKey ?? undefined,
  };

  if (descriptor.adapter === "openai-compatible") {
    return new OpenAICompatibleProvider(options);
  }

  if (descriptor.adapter === "anthropic-native") {
    return new AnthropicProvider(options);
  }

  if (descriptor.adapter === "gemini-native") {
    return new GeminiProvider(options);
  }

  throw new Error(
    descriptor.name + " does not have a configurable runtime yet.",
  );
}

export async function testProviderConfig(
  id: string,
): Promise<ConnectionResult> {
  const config = await getProviderConfig(id);
  if (!config) {
    return { ok: false, message: "Provider configuration was not found." };
  }

  try {
    return await (await createRuntime(config)).testConnection();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Connection failed.",
    };
  }
}

export async function listProviderConfigModels(
  id: string,
): Promise<ModelInfo[]> {
  const config = await getProviderConfig(id);
  if (!config) {
    throw new Error("Provider configuration was not found.");
  }

  return (await createRuntime(config)).listModels();
}

export async function createProviderRuntimeById(id: string) {
  const config = await getProviderConfig(id);
  if (!config) {
    throw new Error("Provider configuration was not found.");
  }

  return {
    config,
    provider: await createRuntime(config),
  };
}


export async function probeProviderConfigModel(
  id: string,
  model?: string,
): Promise<{
  model: string;
  capabilities: ModelCapabilities;
  source: "provider" | "probe" | "inferred";
}> {
  const config = await getProviderConfig(id);
  if (!config) {
    throw new Error("Provider configuration was not found.");
  }

  const runtime = await createRuntime(config);
  const modelId = model?.trim() || config.settings.model;
  if (!modelId) {
    throw new Error("Choose a model before probing capabilities.");
  }

  if (runtime.getModelCapabilities) {
    return {
      model: modelId,
      capabilities: await runtime.getModelCapabilities(modelId),
      source:
        runtime.descriptor.adapter === "openai-compatible"
          ? "inferred"
          : "provider",
    };
  }

  const models = await runtime.listModels();
  const discovered = models.find((item) => item.id === modelId);
  if (!discovered) {
    throw new Error(
      'Model "' + modelId + '" was not returned by this provider.',
    );
  }

  return {
    model: modelId,
    capabilities: discovered.capabilities,
    source: discovered.capabilitySource ?? "provider",
  };
}


export interface ProviderConfigHealth {
  ready: boolean;
  issues: string[];
  warnings: string[];
}

export function inspectProviderConfigHealth(
  config: ProviderConfig,
): ProviderConfigHealth {
  const issues: string[] = [];
  const warnings: string[] = [];
  const descriptor = providerCatalog.find(
    (provider) => provider.id === config.providerId,
  );

  if (!config.enabled) {
    issues.push("Provider is disabled.");
  }

  if (!config.baseUrl.trim()) {
    issues.push("Base URL is missing.");
  }

  if (!config.settings.model?.trim()) {
    issues.push("Model is not selected.");
  }

  if (
    descriptor &&
    (descriptor.adapter === "anthropic-native" ||
      descriptor.adapter === "gemini-native") &&
    !config.hasApiKey
  ) {
    issues.push("API key is missing.");
  } else if (
    descriptor?.region !== "local" &&
    !config.hasApiKey
  ) {
    warnings.push(
      "No API key is stored. This is valid only if the endpoint does not require authentication.",
    );
  }

  if (
    (config.settings.inputCostPerMillion === undefined) !==
    (config.settings.outputCostPerMillion === undefined)
  ) {
    warnings.push(
      "Only one side of token pricing is configured; cost estimates may be incomplete.",
    );
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
  };
}

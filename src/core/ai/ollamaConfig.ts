import { APP_DEFAULTS } from "../../config/appDefaults";
import type { ModelInfo } from "./types";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export const DEFAULT_OLLAMA_BASE_URL: string =
  APP_DEFAULTS.ai.ollama.baseUrl;

export const OLLAMA_DISCOVERY_BASE_URLS =
  APP_DEFAULTS.ai.ollama.discoveryBaseUrls;

const OLLAMA_MODEL_KEY = "ai.ollama.model";
const OLLAMA_BASE_URL_KEY = "ai.ollama.base-url";
const OLLAMA_BASE_URL_SOURCE_KEY = "ai.ollama.base-url-source";
const USER_BASE_URL_SOURCE = "user";

export interface OllamaConfig {
  baseUrl: string;
  model: string | null;
}

export function normalizeOllamaBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";

  if (!trimmed) return DEFAULT_OLLAMA_BASE_URL;

  if (!/^https?:\/\//i.test(trimmed)) {
    return "http://" + trimmed;
  }

  return trimmed;
}

export function getOllamaBaseUrlCandidates(
  preferredBaseUrl?: string | null,
): string[] {
  const candidates = [
    preferredBaseUrl,
    DEFAULT_OLLAMA_BASE_URL,
    ...OLLAMA_DISCOVERY_BASE_URLS,
  ];
  const normalized: string[] = [];

  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;

    const value = normalizeOllamaBaseUrl(candidate);
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }

  return normalized;
}

export function resolvePreferredOllamaBaseUrl(
  storedBaseUrl: string | null,
  source: string | null,
): string {
  if (source !== USER_BASE_URL_SOURCE) {
    return DEFAULT_OLLAMA_BASE_URL;
  }

  return normalizeOllamaBaseUrl(storedBaseUrl);
}

export async function loadOllamaConfig(): Promise<OllamaConfig> {
  const [storedBaseUrl, baseUrlSource, model] = await Promise.all([
    getAppMeta(OLLAMA_BASE_URL_KEY),
    getAppMeta(OLLAMA_BASE_URL_SOURCE_KEY),
    getAppMeta(OLLAMA_MODEL_KEY),
  ]);

  return {
    baseUrl: resolvePreferredOllamaBaseUrl(
      storedBaseUrl,
      baseUrlSource,
    ),
    model,
  };
}

export async function saveOllamaBaseUrl(baseUrl: string): Promise<string> {
  const normalized = normalizeOllamaBaseUrl(baseUrl);
  await Promise.all([
    setAppMeta(OLLAMA_BASE_URL_KEY, normalized),
    setAppMeta(OLLAMA_BASE_URL_SOURCE_KEY, USER_BASE_URL_SOURCE),
  ]);
  return normalized;
}

export async function saveOllamaModel(model: string): Promise<void> {
  await setAppMeta(OLLAMA_MODEL_KEY, model);
}

export function choosePreferredOllamaModel(
  models: ModelInfo[],
  storedModel: string | null,
): string | null {
  if (storedModel && models.some((model) => model.id === storedModel)) {
    return storedModel;
  }

  for (const hint of APP_DEFAULTS.ai.ollama.preferredModelNameHints) {
    const preferred = models.find((model) =>
      model.id.toLowerCase().includes(hint.toLowerCase()),
    );

    if (preferred) return preferred.id;
  }

  return models[0]?.id ?? null;
}

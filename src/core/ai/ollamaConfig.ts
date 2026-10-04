import { APP_DEFAULTS } from "../../config/appDefaults";
import type { ModelInfo } from "./types";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export const DEFAULT_OLLAMA_BASE_URL =
  APP_DEFAULTS.ai.ollama.baseUrl;

const OLLAMA_MODEL_KEY = "ai.ollama.model";

export interface OllamaConfig {
  baseUrl: string;
  model: string | null;
}

export async function loadOllamaConfig(): Promise<OllamaConfig> {
  return {
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: await getAppMeta(OLLAMA_MODEL_KEY),
  };
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

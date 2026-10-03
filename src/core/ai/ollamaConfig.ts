import type { ModelInfo } from "./types";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

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

  const qwen35 = models.find((model) =>
    model.id.toLowerCase().includes("qwen3.5"),
  );
  if (qwen35) return qwen35.id;

  const qwen = models.find((model) =>
    model.id.toLowerCase().includes("qwen"),
  );
  if (qwen) return qwen.id;

  return models[0]?.id ?? null;
}

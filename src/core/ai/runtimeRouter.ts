import type { AIProvider } from "./provider";
import {
  createProviderRuntimeById,
  listProviderConfigs,
} from "./providerConfigs";
import {
  loadOllamaConfig,
  saveOllamaModel,
} from "./ollamaConfig";
import { OllamaProvider } from "./providers/ollama";
import { loadAiPrivacyMode } from "./privacy";
import {
  loadTaskRouteTarget,
  resolveOllamaModelForTask,
  type ReadingTaskType,
} from "./taskRouting";

export interface ResolvedTextRuntime {
  provider: AIProvider;
  model: string;
  cacheModelKey: string;
  local: boolean;
  providerConfigId?: string;
  label: string;
}

async function localRuntime(
  task: ReadingTaskType,
): Promise<ResolvedTextRuntime> {
  const config = await loadOllamaConfig();
  const provider = new OllamaProvider(config.baseUrl);
  const models = await provider.listModels();
  const model = await resolveOllamaModelForTask(
    task,
    models,
    config.model,
  );

  if (!model) {
    throw new Error(
      "Ollama is running, but no local model is installed. Pull a model first.",
    );
  }

  if (!config.model) {
    await saveOllamaModel(model);
  }

  return {
    provider,
    model,
    cacheModelKey: "ollama:" + model,
    local: true,
    label: "Ollama · " + model,
  };
}

async function providerRuntime(
  configId: string,
  routedModel: string,
): Promise<ResolvedTextRuntime> {
  const { config, provider } =
    await createProviderRuntimeById(configId);

  if (!config.enabled) {
    throw new Error(config.displayName + " is disabled.");
  }

  const model = routedModel || config.settings.model;
  if (!model) {
    throw new Error(
      "No model is configured for " + config.displayName + ".",
    );
  }

  return {
    provider,
    model,
    cacheModelKey:
      "provider:" + config.id + ":" + model,
    local: provider.descriptor.region === "local",
    providerConfigId: config.id,
    label: config.displayName + " · " + model,
  };
}

async function defaultCloudRuntime(): Promise<ResolvedTextRuntime> {
  const configs = (await listProviderConfigs()).filter(
    (config) =>
      config.enabled &&
      Boolean(config.settings.model),
  );

  for (const config of configs) {
    const runtime = await providerRuntime(
      config.id,
      config.settings.model ?? "",
    );
    if (!runtime.local) {
      return runtime;
    }
  }

  throw new Error(
    "Cloud routing needs at least one enabled cloud provider with a model configured.",
  );
}

async function localWithAutomaticFallback(
  task: ReadingTaskType,
): Promise<ResolvedTextRuntime> {
  try {
    return await localRuntime(task);
  } catch (localError) {
    try {
      return await defaultCloudRuntime();
    } catch {
      throw localError;
    }
  }
}

export async function resolveTextTaskRuntime(
  task: ReadingTaskType,
): Promise<ResolvedTextRuntime> {
  const [privacyMode, target] = await Promise.all([
    loadAiPrivacyMode(),
    loadTaskRouteTarget(task),
  ]);

  if (privacyMode === "local-only") {
    return localRuntime(task);
  }

  if (privacyMode === "cloud-only") {
    if (target?.kind === "provider") {
      const routed = await providerRuntime(
        target.configId,
        target.model,
      );
      if (!routed.local) return routed;
    }

    return defaultCloudRuntime();
  }

  if (target?.kind === "provider") {
    return providerRuntime(
      target.configId,
      target.model,
    );
  }

  if (privacyMode === "automatic") {
    return localWithAutomaticFallback(task);
  }

  return localRuntime(task);
}

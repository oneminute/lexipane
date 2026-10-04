import type { AIProvider } from "./provider";
import {
  createProviderRuntimeById,
  listProviderConfigs,
} from "./providerConfigs";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "./ollamaConfig";
import { OllamaProvider } from "./providers/ollama";
import {
  loadAiPrivacyMode,
  type AiPrivacyMode,
} from "./privacy";
import {
  loadTaskRoutePlan,
  type ReadingTaskType,
  type TaskRouteTarget,
} from "./taskRouting";
import {
  loadBookPrivacyMode,
  loadBookProviderPolicy,
  type BookProviderPolicy,
} from "../books/bookPrivacy";
import type { AiPricing } from "./usage";

export interface ResolvedTextRuntime {
  provider: AIProvider;
  model: string;
  cacheModelKey: string;
  local: boolean;
  providerKey: string;
  providerId: string;
  providerConfigId?: string;
  label: string;
  pricing?: AiPricing;
}

function runtimeKey(runtime: ResolvedTextRuntime): string {
  return runtime.cacheModelKey;
}

async function effectivePrivacyMode(
  bookPath?: string | null,
): Promise<AiPrivacyMode> {
  if (bookPath) {
    const bookMode = await loadBookPrivacyMode(bookPath);
    if (bookMode) return bookMode;
  }

  return loadAiPrivacyMode();
}

async function effectiveProviderPolicy(
  bookPath?: string | null,
): Promise<BookProviderPolicy> {
  return bookPath
    ? loadBookProviderPolicy(bookPath)
    : { mode: "all", providerKeys: [] };
}

async function localRuntime(
  task: ReadingTaskType,
  requestedModel?: string,
): Promise<ResolvedTextRuntime> {
  const config = await loadOllamaConfig();
  const provider = new OllamaProvider(config.baseUrl);
  const models = await provider.listModels();

  const requested = requestedModel
    ? models.find((model) => model.id === requestedModel)?.id ?? null
    : null;

  const model =
    requested ??
    choosePreferredOllamaModel(models, config.model);

  if (!model) {
    throw new Error(
      requestedModel
        ? 'Ollama model "' + requestedModel + '" is not installed.'
        : "Ollama is running, but no local model is installed. Pull a model first.",
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
    providerKey: "ollama",
    providerId: "ollama",
    label: "Ollama · " + model,
    pricing: {
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
    },
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
    providerKey: "config:" + config.id,
    providerId: config.providerId,
    providerConfigId: config.id,
    label: config.displayName + " · " + model,
    pricing: {
      inputCostPerMillion: config.settings.inputCostPerMillion,
      outputCostPerMillion: config.settings.outputCostPerMillion,
    },
  };
}

async function runtimeFromTarget(
  task: ReadingTaskType,
  target: TaskRouteTarget,
): Promise<ResolvedTextRuntime> {
  return target.kind === "ollama"
    ? localRuntime(task, target.model)
    : providerRuntime(target.configId, target.model);
}

async function configuredCloudRuntimes(): Promise<ResolvedTextRuntime[]> {
  const configs = (await listProviderConfigs()).filter(
    (config) => config.enabled && Boolean(config.settings.model),
  );

  const runtimes: ResolvedTextRuntime[] = [];

  for (const config of configs) {
    try {
      const runtime = await providerRuntime(
        config.id,
        config.settings.model ?? "",
      );
      if (!runtime.local) runtimes.push(runtime);
    } catch {
      // One stale provider must not block the remaining fallback chain.
    }
  }

  return runtimes;
}

function acceptsPrivacy(
  runtime: ResolvedTextRuntime,
  mode: AiPrivacyMode,
): boolean {
  if (mode === "local-only") return runtime.local;
  if (mode === "cloud-only") return !runtime.local;
  return true;
}

function acceptsProviderPolicy(
  runtime: ResolvedTextRuntime,
  policy: BookProviderPolicy,
): boolean {
  if (policy.mode === "all") return true;

  const matched = policy.providerKeys.includes(runtime.providerKey);
  return policy.mode === "allow" ? matched : !matched;
}

function dedupeRuntimes(
  runtimes: ResolvedTextRuntime[],
): ResolvedTextRuntime[] {
  const seen = new Set<string>();
  const result: ResolvedTextRuntime[] = [];

  for (const runtime of runtimes) {
    const key = runtimeKey(runtime);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(runtime);
  }

  return result;
}

export async function resolveTextTaskRuntimes(
  task: ReadingTaskType,
  bookPath?: string | null,
): Promise<ResolvedTextRuntime[]> {
  const [privacyMode, providerPolicy, plan] = await Promise.all([
    effectivePrivacyMode(bookPath),
    effectiveProviderPolicy(bookPath),
    loadTaskRoutePlan(task),
  ]);

  const orderedTargets = [
    ...(plan.primary ? [plan.primary] : []),
    ...plan.fallbacks,
  ];

  const routed: ResolvedTextRuntime[] = [];

  for (const target of orderedTargets) {
    try {
      const runtime = await runtimeFromTarget(task, target);
      if (
        acceptsPrivacy(runtime, privacyMode) &&
        acceptsProviderPolicy(runtime, providerPolicy)
      ) {
        routed.push(runtime);
      }
    } catch {
      // Resolution failures are skipped so another fallback can still run.
    }
  }

  if (privacyMode === "local-only") {
    try {
      routed.push(await localRuntime(task));
    } catch {
      // Keep any explicit local fallback that already resolved.
    }
  } else if (privacyMode === "cloud-only") {
    routed.push(...(await configuredCloudRuntimes()));
  } else if (privacyMode === "automatic") {
    try {
      routed.push(await localRuntime(task));
    } catch {
      // Configured cloud routes may still work.
    }
    routed.push(...(await configuredCloudRuntimes()));
  } else if (routed.length === 0) {
    // Prefer-local never silently uploads a book just because Ollama failed.
    try {
      routed.push(await localRuntime(task));
    } catch {
      // Error below explains the final routing state.
    }
  }

  const result = dedupeRuntimes(routed).filter(
    (runtime) =>
      acceptsPrivacy(runtime, privacyMode) &&
      acceptsProviderPolicy(runtime, providerPolicy),
  );

  if (result.length === 0) {
    if (providerPolicy.mode !== "all") {
      throw new Error(
        "This book's provider allow/deny policy leaves no usable AI route.",
      );
    }

    throw new Error(
      privacyMode === "local-only"
        ? "This book is Local Only, but no usable local AI route is available."
        : privacyMode === "cloud-only"
          ? "This book is Cloud Only, but no usable cloud AI route is configured."
          : "No usable AI runtime is available for this task.",
    );
  }

  return result;
}

export async function resolveTextTaskRuntime(
  task: ReadingTaskType,
  bookPath?: string | null,
): Promise<ResolvedTextRuntime> {
  const runtimes = await resolveTextTaskRuntimes(task, bookPath);
  return runtimes[0];
}

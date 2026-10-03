import type { ModelInfo } from "./types";
import { choosePreferredOllamaModel } from "./ollamaConfig";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type ReadingTaskType =
  | "explain"
  | "grammar"
  | "ask"
  | "difficulty"
  | "region";

export type TaskRouteTarget =
  | {
      kind: "ollama";
      model: string;
    }
  | {
      kind: "provider";
      configId: string;
      model: string;
    };

const legacyTaskRouteKey = (task: ReadingTaskType) => "ai.route." + task;
const taskRouteKey = (task: ReadingTaskType) => "ai.route.v2." + task;

export async function loadTaskModel(
  task: ReadingTaskType,
): Promise<string | null> {
  return getAppMeta(legacyTaskRouteKey(task));
}

export async function saveTaskModel(
  task: ReadingTaskType,
  model: string,
): Promise<void> {
  await setAppMeta(legacyTaskRouteKey(task), model);
  await saveTaskRouteTarget(task, {
    kind: "ollama",
    model,
  });
}

export async function loadTaskRouteTarget(
  task: ReadingTaskType,
): Promise<TaskRouteTarget | null> {
  const stored = await getAppMeta(taskRouteKey(task));

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<TaskRouteTarget>;

      if (
        parsed.kind === "ollama" &&
        typeof parsed.model === "string" &&
        parsed.model
      ) {
        return {
          kind: "ollama",
          model: parsed.model,
        };
      }

      if (
        parsed.kind === "provider" &&
        typeof parsed.configId === "string" &&
        parsed.configId &&
        typeof parsed.model === "string" &&
        parsed.model
      ) {
        return {
          kind: "provider",
          configId: parsed.configId,
          model: parsed.model,
        };
      }
    } catch {
      // Fall through to the legacy local model route.
    }
  }

  const legacy = await loadTaskModel(task);
  return legacy
    ? {
        kind: "ollama",
        model: legacy,
      }
    : null;
}

export async function saveTaskRouteTarget(
  task: ReadingTaskType,
  target: TaskRouteTarget,
): Promise<void> {
  await setAppMeta(taskRouteKey(task), JSON.stringify(target));

  if (target.kind === "ollama") {
    await setAppMeta(legacyTaskRouteKey(task), target.model);
  }
}

export async function resolveOllamaModelForTask(
  task: ReadingTaskType,
  models: ModelInfo[],
  defaultModel: string | null,
): Promise<string | null> {
  const target = await loadTaskRouteTarget(task);

  if (
    target?.kind === "ollama" &&
    models.some((model) => model.id === target.model)
  ) {
    return target.model;
  }

  return choosePreferredOllamaModel(models, defaultModel);
}

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

export interface TaskRoutePlan {
  primary: TaskRouteTarget | null;
  fallbacks: TaskRouteTarget[];
}

const legacyTaskRouteKey = (task: ReadingTaskType) => "ai.route." + task;
const taskRouteKey = (task: ReadingTaskType) => "ai.route.v2." + task;
const taskRoutePlanKey = (task: ReadingTaskType) => "ai.route.v3." + task;

export function isTaskRouteTarget(value: unknown): value is TaskRouteTarget {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  if (
    record.kind === "ollama" &&
    typeof record.model === "string" &&
    record.model
  ) {
    return true;
  }

  return (
    record.kind === "provider" &&
    typeof record.configId === "string" &&
    Boolean(record.configId) &&
    typeof record.model === "string" &&
    Boolean(record.model)
  );
}

export function normalizeTaskRoutePlan(
  value: unknown,
): TaskRoutePlan | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const primary = isTaskRouteTarget(record.primary)
    ? record.primary
    : null;
  const fallbacks = Array.isArray(record.fallbacks)
    ? record.fallbacks.filter(isTaskRouteTarget).slice(0, 4)
    : [];

  if (!primary && fallbacks.length === 0) return null;

  return { primary, fallbacks };
}

export async function loadTaskModel(
  task: ReadingTaskType,
): Promise<string | null> {
  return getAppMeta(legacyTaskRouteKey(task));
}

export async function loadTaskRouteTarget(
  task: ReadingTaskType,
): Promise<TaskRouteTarget | null> {
  return (await loadTaskRoutePlan(task)).primary;
}

export async function loadTaskRoutePlan(
  task: ReadingTaskType,
): Promise<TaskRoutePlan> {
  const storedPlan = await getAppMeta(taskRoutePlanKey(task));

  if (storedPlan) {
    try {
      const parsed = normalizeTaskRoutePlan(JSON.parse(storedPlan));
      if (parsed) return parsed;
    } catch {
      // Fall through to earlier route formats.
    }
  }

  const storedTarget = await getAppMeta(taskRouteKey(task));
  if (storedTarget) {
    try {
      const parsed = JSON.parse(storedTarget);
      if (isTaskRouteTarget(parsed)) {
        return {
          primary: parsed,
          fallbacks: [],
        };
      }
    } catch {
      // Fall through to legacy Ollama-only storage.
    }
  }

  const legacy = await loadTaskModel(task);
  return {
    primary: legacy
      ? {
          kind: "ollama",
          model: legacy,
        }
      : null,
    fallbacks: [],
  };
}

export async function saveTaskRoutePlan(
  task: ReadingTaskType,
  plan: TaskRoutePlan,
): Promise<void> {
  const normalized: TaskRoutePlan = {
    primary: plan.primary,
    fallbacks: plan.fallbacks
      .filter((target, index, items) => {
        const key = JSON.stringify(target);
        return (
          (!plan.primary || key !== JSON.stringify(plan.primary)) &&
          items.findIndex((item) => JSON.stringify(item) === key) === index
        );
      })
      .slice(0, 4),
  };

  await setAppMeta(taskRoutePlanKey(task), JSON.stringify(normalized));

  if (normalized.primary) {
    await setAppMeta(
      taskRouteKey(task),
      JSON.stringify(normalized.primary),
    );

    if (normalized.primary.kind === "ollama") {
      await setAppMeta(
        legacyTaskRouteKey(task),
        normalized.primary.model,
      );
    }
  }
}

export async function saveTaskModel(
  task: ReadingTaskType,
  model: string,
): Promise<void> {
  await saveTaskRoutePlan(task, {
    primary: {
      kind: "ollama",
      model,
    },
    fallbacks: [],
  });
}

export async function saveTaskRouteTarget(
  task: ReadingTaskType,
  target: TaskRouteTarget,
): Promise<void> {
  const current = await loadTaskRoutePlan(task);
  await saveTaskRoutePlan(task, {
    primary: target,
    fallbacks: current.fallbacks,
  });
}

export async function resolveOllamaModelForTask(
  task: ReadingTaskType,
  models: ModelInfo[],
  defaultModel: string | null,
): Promise<string | null> {
  const plan = await loadTaskRoutePlan(task);
  const ollamaTarget = [
    plan.primary,
    ...plan.fallbacks,
  ].find(
    (target): target is Extract<TaskRouteTarget, { kind: "ollama" }> =>
      target?.kind === "ollama" &&
      models.some((model) => model.id === target.model),
  );

  if (ollamaTarget) {
    return ollamaTarget.model;
  }

  return choosePreferredOllamaModel(models, defaultModel);
}

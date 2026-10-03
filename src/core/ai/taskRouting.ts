import type { ModelInfo } from "./types";
import { choosePreferredOllamaModel } from "./ollamaConfig";
import { getAppMeta, setAppMeta } from "../settings/appMeta";

export type ReadingTaskType =
  | "explain"
  | "grammar"
  | "ask"
  | "difficulty"
  | "region";

const taskRouteKey = (task: ReadingTaskType) => "ai.route." + task;

export async function loadTaskModel(
  task: ReadingTaskType,
): Promise<string | null> {
  return getAppMeta(taskRouteKey(task));
}

export async function saveTaskModel(
  task: ReadingTaskType,
  model: string,
): Promise<void> {
  await setAppMeta(taskRouteKey(task), model);
}

export async function resolveOllamaModelForTask(
  task: ReadingTaskType,
  models: ModelInfo[],
  defaultModel: string | null,
): Promise<string | null> {
  const routed = await loadTaskModel(task);
  if (routed && models.some((model) => model.id === routed)) {
    return routed;
  }

  return choosePreferredOllamaModel(models, defaultModel);
}

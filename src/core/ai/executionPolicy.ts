import { getAppMeta, setAppMeta } from "../settings/appMeta";
import type { ReadingTaskType } from "./taskRouting";

export interface AiExecutionPolicy {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

const defaults: Record<ReadingTaskType, AiExecutionPolicy> = {
  explain: { timeoutMs: 60000, retries: 1, retryDelayMs: 700 },
  grammar: { timeoutMs: 75000, retries: 1, retryDelayMs: 700 },
  ask: { timeoutMs: 75000, retries: 1, retryDelayMs: 700 },
  difficulty: { timeoutMs: 30000, retries: 0, retryDelayMs: 500 },
  region: { timeoutMs: 90000, retries: 0, retryDelayMs: 800 },
};

const keyFor = (task: ReadingTaskType) => "ai.execution.v1." + task;

export function defaultAiExecutionPolicy(
  task: ReadingTaskType,
): AiExecutionPolicy {
  return { ...defaults[task] };
}

export function normalizeAiExecutionPolicy(
  task: ReadingTaskType,
  value: Partial<AiExecutionPolicy> | null | undefined,
): AiExecutionPolicy {
  const fallback = defaultAiExecutionPolicy(task);

  const timeoutMs = Math.round(Number(value?.timeoutMs));
  const retries = Math.round(Number(value?.retries));
  const retryDelayMs = Math.round(Number(value?.retryDelayMs));

  return {
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs >= 5000 && timeoutMs <= 300000
        ? timeoutMs
        : fallback.timeoutMs,
    retries:
      Number.isFinite(retries) && retries >= 0 && retries <= 3
        ? retries
        : fallback.retries,
    retryDelayMs:
      Number.isFinite(retryDelayMs) &&
      retryDelayMs >= 0 &&
      retryDelayMs <= 10000
        ? retryDelayMs
        : fallback.retryDelayMs,
  };
}

export async function loadAiExecutionPolicy(
  task: ReadingTaskType,
): Promise<AiExecutionPolicy> {
  const stored = await getAppMeta(keyFor(task));
  if (!stored) return defaultAiExecutionPolicy(task);

  try {
    return normalizeAiExecutionPolicy(
      task,
      JSON.parse(stored) as Partial<AiExecutionPolicy>,
    );
  } catch {
    return defaultAiExecutionPolicy(task);
  }
}

export async function saveAiExecutionPolicy(
  task: ReadingTaskType,
  policy: AiExecutionPolicy,
): Promise<void> {
  await setAppMeta(
    keyFor(task),
    JSON.stringify(normalizeAiExecutionPolicy(task, policy)),
  );
}

export function isRetryableAiError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLocaleLowerCase();

  if (
    normalized.includes("structured") ||
    normalized.includes("valid json") ||
    normalized.includes("missing meaning") ||
    normalized.includes("missing answer")
  ) {
    return false;
  }

  const httpMatch = message.match(/HTTP\s+(\d{3})/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);

    if ([400, 401, 403, 404, 405, 422].includes(status)) {
      return false;
    }

    return (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  return (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("connection reset") ||
    normalized.includes("econnreset") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("aborterror")
  );
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function runWithAiExecutionPolicy<T>(
  task: ReadingTaskType,
  operation: (signal: AbortSignal, attempt: number) => Promise<T>,
  policyOverride?: AiExecutionPolicy,
): Promise<T> {
  const policy = policyOverride ?? (await loadAiExecutionPolicy(task));
  let lastError: unknown;

  for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, policy.timeoutMs);

    try {
      return await operation(controller.signal, attempt);
    } catch (error) {
      lastError = timedOut
        ? new Error(
            "AI request timed out after " +
              Math.round(policy.timeoutMs / 1000) +
              " seconds.",
          )
        : error;

      const canRetry =
        attempt < policy.retries && isRetryableAiError(lastError);

      if (!canRetry) {
        throw lastError;
      }

      await delay(policy.retryDelayMs * (attempt + 1));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI request failed.");
}

import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import type { AIUsage } from "./types";

export interface AiUsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
}

interface UsageSummaryRow {
  requests: number;
  input_tokens: number | null;
  output_tokens: number | null;
  average_latency_ms: number | null;
}

export async function recordAiUsage(
  model: string,
  taskType: string,
  usage: AIUsage | undefined,
  latencyMs: number,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "INSERT INTO ai_usage " +
      "(id, provider_config_id, model_id, task_type, input_tokens, output_tokens, estimated_cost, latency_ms, created_at) " +
      "VALUES ($1, NULL, $2, $3, $4, $5, 0, $6, $7)",
    [
      crypto.randomUUID(),
      model,
      taskType,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      Math.round(latencyMs),
      new Date().toISOString(),
    ],
  );
}

export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  if (!isTauri()) {
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      averageLatencyMs: 0,
    };
  }

  const db = await initializeDatabase();
  if (!db) {
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      averageLatencyMs: 0,
    };
  }

  const rows = await db.select<UsageSummaryRow[]>(
    "SELECT COUNT(*) AS requests, " +
      "COALESCE(SUM(input_tokens), 0) AS input_tokens, " +
      "COALESCE(SUM(output_tokens), 0) AS output_tokens, " +
      "COALESCE(AVG(latency_ms), 0) AS average_latency_ms " +
      "FROM ai_usage",
  );

  const row = rows[0];
  const inputTokens = Number(row?.input_tokens ?? 0);
  const outputTokens = Number(row?.output_tokens ?? 0);

  return {
    requests: Number(row?.requests ?? 0),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    averageLatencyMs: Math.round(Number(row?.average_latency_ms ?? 0)),
  };
}

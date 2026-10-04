import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import type { AIUsage } from "./types";

export interface AiPricing {
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export interface AiUsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  averageLatencyMs: number;
  estimatedCost: number;
  estimatedCostToday: number;
  estimatedCostThisMonth: number;
  localRequests: number;
  cloudRequests: number;
}

interface UsageSummaryRow {
  requests: number;
  input_tokens: number | null;
  output_tokens: number | null;
  average_latency_ms: number | null;
  estimated_cost: number | null;
  estimated_cost_today: number | null;
  estimated_cost_month: number | null;
  local_requests: number | null;
  cloud_requests: number | null;
}

export function estimateAiCost(
  usage: AIUsage | undefined,
  pricing: AiPricing | undefined,
): number | null {
  if (!pricing) return null;

  const inputPrice = pricing.inputCostPerMillion;
  const outputPrice = pricing.outputCostPerMillion;

  if (
    typeof inputPrice !== "number" &&
    typeof outputPrice !== "number"
  ) {
    return null;
  }

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;

  return (
    (inputTokens / 1_000_000) * (inputPrice ?? 0) +
    (outputTokens / 1_000_000) * (outputPrice ?? 0)
  );
}

export async function recordAiUsage(
  model: string,
  taskType: string,
  usage: AIUsage | undefined,
  latencyMs: number,
  providerConfigId?: string,
  pricing?: AiPricing,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const estimatedCost =
    providerConfigId === undefined
      ? 0
      : estimateAiCost(usage, pricing);

  await db.execute(
    "INSERT INTO ai_usage " +
      "(id, provider_config_id, model_id, task_type, input_tokens, output_tokens, estimated_cost, latency_ms, created_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      crypto.randomUUID(),
      providerConfigId ?? null,
      model,
      taskType,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      estimatedCost,
      Math.round(latencyMs),
      new Date().toISOString(),
    ],
  );
}

function emptySummary(): AiUsageSummary {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    averageLatencyMs: 0,
    estimatedCost: 0,
    estimatedCostToday: 0,
    estimatedCostThisMonth: 0,
    localRequests: 0,
    cloudRequests: 0,
  };
}

export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  if (!isTauri()) return emptySummary();

  const db = await initializeDatabase();
  if (!db) return emptySummary();

  const rows = await db.select<UsageSummaryRow[]>(
    "SELECT COUNT(*) AS requests, " +
      "COALESCE(SUM(input_tokens), 0) AS input_tokens, " +
      "COALESCE(SUM(output_tokens), 0) AS output_tokens, " +
      "COALESCE(AVG(latency_ms), 0) AS average_latency_ms, " +
      "COALESCE(SUM(estimated_cost), 0) AS estimated_cost, " +
      "COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = date('now') THEN estimated_cost ELSE 0 END), 0) AS estimated_cost_today, " +
      "COALESCE(SUM(CASE WHEN substr(created_at, 1, 7) = strftime('%Y-%m', 'now') THEN estimated_cost ELSE 0 END), 0) AS estimated_cost_month, " +
      "COALESCE(SUM(CASE WHEN provider_config_id IS NULL THEN 1 ELSE 0 END), 0) AS local_requests, " +
      "COALESCE(SUM(CASE WHEN provider_config_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS cloud_requests " +
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
    estimatedCost: Number(row?.estimated_cost ?? 0),
    estimatedCostToday: Number(row?.estimated_cost_today ?? 0),
    estimatedCostThisMonth: Number(row?.estimated_cost_month ?? 0),
    localRequests: Number(row?.local_requests ?? 0),
    cloudRequests: Number(row?.cloud_requests ?? 0),
  };
}

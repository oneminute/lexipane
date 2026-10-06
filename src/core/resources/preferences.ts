import { getAppMeta, setAppMeta } from "../settings/appMeta";
import { setResourceTransferConcurrency } from "./native";

const TRANSFER_CONCURRENCY_KEY =
  "resources.transfer.direct-concurrency";

export const DEFAULT_RESOURCE_TRANSFER_CONCURRENCY = 3;

export function normalizeResourceTransferConcurrency(
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RESOURCE_TRANSFER_CONCURRENCY;
  }

  return Math.max(1, Math.min(8, Math.trunc(value)));
}

export async function loadResourceTransferConcurrency(): Promise<number> {
  const stored = await getAppMeta(TRANSFER_CONCURRENCY_KEY);
  if (stored === null) return DEFAULT_RESOURCE_TRANSFER_CONCURRENCY;

  return normalizeResourceTransferConcurrency(Number(stored));
}

export async function saveResourceTransferConcurrency(
  value: number,
): Promise<number> {
  const normalized = normalizeResourceTransferConcurrency(value);
  await setAppMeta(TRANSFER_CONCURRENCY_KEY, String(normalized));
  return setResourceTransferConcurrency(normalized);
}

export async function initializeResourceTransferConcurrency(): Promise<number> {
  const configured = await loadResourceTransferConcurrency();
  return setResourceTransferConcurrency(configured);
}

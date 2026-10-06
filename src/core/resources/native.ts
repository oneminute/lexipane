import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ResourceNativeCapabilities } from "./types";

const WEB_FALLBACK: ResourceNativeCapabilities = {
  coreVersion: 1,
  persistentJobs: false,
  directTransferConcurrency: 3,
  liveTransports: {
    http: false,
    torrent: false,
    ed2k: false,
    cloud: false,
    webdav: false,
    s3: false,
  },
};

export async function getResourceNativeCapabilities(): Promise<
  ResourceNativeCapabilities
> {
  if (!isTauri()) return WEB_FALLBACK;

  return invoke<ResourceNativeCapabilities>(
    "resource_runtime_capabilities",
  );
}


export async function setResourceTransferConcurrency(
  limit: number,
): Promise<number> {
  const normalized = Math.max(1, Math.min(8, Math.trunc(limit || 3)));
  if (!isTauri()) return normalized;

  return invoke<number>("resource_transfer_set_concurrency", {
    limit: normalized,
  });
}

export async function getResourceTransferConcurrency(): Promise<{
  limit: number;
  active: number;
}> {
  if (!isTauri()) return { limit: 3, active: 0 };

  const [limit, active] = await invoke<[number, number]>(
    "resource_transfer_concurrency",
  );

  return { limit, active };
}

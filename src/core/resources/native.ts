import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ResourceNativeCapabilities } from "./types";

const WEB_FALLBACK: ResourceNativeCapabilities = {
  coreVersion: 1,
  persistentJobs: false,
  liveTransports: {
    http: false,
    torrent: false,
    ed2k: false,
    cloud: false,
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

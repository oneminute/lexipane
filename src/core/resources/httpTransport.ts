import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface HttpProbeResult {
  finalUrl: string;
  status: number;
  contentType?: string;
  contentLength?: number;
  acceptRanges: boolean;
  fileName?: string;
}

export interface HttpTextResponse {
  finalUrl: string;
  contentType?: string;
  body: string;
}

export interface HttpTransferStartResult {
  jobId: string;
  started: boolean;
}

export interface ResourceTransferEvent {
  jobId: string;
  state:
    | "running"
    | "paused"
    | "downloaded"
    | "failed"
    | "canceled";
  bytesTotal?: number;
  bytesCompleted: number;
  progress: number;
  downloadRate?: number;
  tempPath?: string;
  fileName?: string;
  contentType?: string;
  finalUrl?: string;
  detectedFormat?: string;
  error?: string;
}

export async function probeHttpResource(
  url: string,
): Promise<HttpProbeResult> {
  if (!isTauri()) {
    throw new Error("HTTP probing requires the desktop application.");
  }

  return invoke<HttpProbeResult>("resource_http_probe", { url });
}

export async function fetchHttpText(
  url: string,
  maxBytes?: number,
): Promise<HttpTextResponse> {
  if (!isTauri()) {
    throw new Error("HTTP catalog access requires the desktop application.");
  }

  return invoke<HttpTextResponse>("resource_http_fetch_text", {
    url,
    maxBytes,
  });
}

export async function startHttpDownload(
  jobId: string,
  url: string,
  fileNameHint?: string,
): Promise<HttpTransferStartResult> {
  if (!isTauri()) {
    throw new Error("HTTP downloads require the desktop application.");
  }

  return invoke<HttpTransferStartResult>(
    "resource_http_start_download",
    {
      jobId,
      url,
      fileNameHint,
    },
  );
}

export async function pauseHttpDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_http_pause", { jobId });
}

export async function cancelHttpDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_http_cancel", { jobId });
}

export async function cleanupHttpTransferTemp(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_http_cleanup_temp", { jobId });
}

export async function listenForResourceTransferEvents(
  handler: (event: ResourceTransferEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};

  return listen<ResourceTransferEvent>(
    "resource-transfer-event",
    ({ payload }) => handler(payload),
  );
}

import { isSupportedResourceBook } from "./bookFormats";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type CloudProviderId =
  | "google-drive"
  | "dropbox"
  | "onedrive";

export interface CloudEntry {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  isFolder: boolean;
  path?: string;
  modifiedAt?: string;
}

export interface CloudListResult {
  provider: CloudProviderId;
  entries: CloudEntry[];
}

export interface CloudTokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export async function refreshCloudAccessToken(
  provider: CloudProviderId,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
  tenant?: string,
): Promise<CloudTokenRefreshResult> {
  if (!isTauri()) {
    throw new Error("Cloud token refresh requires the desktop application.");
  }

  return invoke<CloudTokenRefreshResult>(
    "resource_cloud_refresh_token",
    {
      provider,
      refreshToken,
      clientId,
      clientSecret,
      tenant,
    },
  );
}

export async function listCloudEntries(
  provider: CloudProviderId,
  accessToken: string,
  folder?: string,
): Promise<CloudListResult> {
  if (!isTauri()) {
    throw new Error("Cloud browsing requires the desktop application.");
  }

  return invoke<CloudListResult>("resource_cloud_list", {
    provider,
    accessToken,
    folder,
  });
}

export async function searchCloudEntries(
  provider: CloudProviderId,
  accessToken: string,
  query: string,
  folder?: string,
): Promise<CloudListResult> {
  if (!isTauri()) {
    throw new Error("Cloud search requires the desktop application.");
  }

  return invoke<CloudListResult>("resource_cloud_search", {
    provider,
    accessToken,
    query,
    folder,
  });
}

export async function startCloudDownload(
  jobId: string,
  provider: CloudProviderId,
  accessToken: string,
  fileId: string,
  fileName: string,
  filePath?: string,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("Cloud downloads require the desktop application.");
  }

  return invoke<boolean>("resource_cloud_start_download", {
    jobId,
    provider,
    accessToken,
    fileId,
    filePath,
    fileName,
  });
}

export async function pauseCloudDownload(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_cloud_pause", { jobId });
}

export async function cancelCloudDownload(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_cloud_cancel", { jobId });
}

export async function cleanupCloudTransfer(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_cloud_cleanup", { jobId });
}

export function cloudFolderLocator(
  provider: CloudProviderId,
  entry: CloudEntry,
): string {
  if (provider === "dropbox") {
    return entry.path ?? entry.id;
  }

  return entry.id;
}

export function cloudEntryIsBook(entry: CloudEntry): boolean {
  return (
    !entry.isFolder &&
    isSupportedResourceBook(entry.name, entry.mimeType)
  );
}

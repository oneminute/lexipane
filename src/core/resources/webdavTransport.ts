import { invoke, isTauri } from "@tauri-apps/api/core";

export interface WebDavEntry {
  id: string;
  name: string;
  href: string;
  size?: number;
  mimeType?: string;
  isFolder: boolean;
  modifiedAt?: string;
}

export interface WebDavListResult {
  baseUrl: string;
  path: string;
  entries: WebDavEntry[];
}

export interface WebDavConnection {
  baseUrl: string;
  username: string;
  password?: string;
}

export async function listWebDavEntries(
  connection: WebDavConnection,
  path?: string,
): Promise<WebDavListResult> {
  if (!isTauri()) {
    throw new Error("WebDAV browsing requires the desktop application.");
  }

  return invoke<WebDavListResult>("resource_webdav_list", {
    baseUrl: connection.baseUrl,
    username: connection.username,
    password: connection.password,
    path,
  });
}

export async function startWebDavDownload(
  jobId: string,
  connection: WebDavConnection,
  entry: WebDavEntry,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("WebDAV downloads require the desktop application.");
  }

  return invoke<boolean>("resource_webdav_start_download", {
    jobId,
    fileUrl: entry.href,
    username: connection.username,
    password: connection.password,
    fileName: entry.name,
  });
}

export async function pauseWebDavDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_webdav_pause", { jobId });
}

export async function cancelWebDavDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_webdav_cancel", { jobId });
}

export async function cleanupWebDavTransfer(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_webdav_cleanup", { jobId });
}

export function webDavEntryIsBook(entry: WebDavEntry): boolean {
  if (entry.isFolder) return false;
  const lower = entry.name.toLowerCase();
  const mime = entry.mimeType?.toLowerCase() ?? "";

  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".epub") ||
    mime.includes("application/pdf") ||
    mime.includes("application/epub+zip")
  );
}

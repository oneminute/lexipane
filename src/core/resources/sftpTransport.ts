import { invoke, isTauri } from "@tauri-apps/api/core";
import { isSupportedResourceBook } from "./bookFormats";

export interface SftpConnection {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface SftpEntry {
  id: string;
  name: string;
  path: string;
  size?: number;
  isFolder: boolean;
  modifiedAt?: number;
}

export interface SftpListResult {
  path: string;
  entries: SftpEntry[];
  truncated: boolean;
}

function invokeConnection(connection: SftpConnection) {
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    privateKeyPath: connection.privateKeyPath,
    privateKeyPassphrase: connection.privateKeyPassphrase,
  };
}

export async function listSftpEntries(
  connection: SftpConnection,
  path?: string,
): Promise<SftpListResult> {
  if (!isTauri()) {
    throw new Error("SFTP browsing requires the desktop application.");
  }

  return invoke<SftpListResult>("resource_sftp_list", {
    ...invokeConnection(connection),
    path,
  });
}

export async function searchSftpEntries(
  connection: SftpConnection,
  query: string,
  path?: string,
): Promise<SftpListResult> {
  if (!isTauri()) {
    throw new Error("SFTP search requires the desktop application.");
  }

  return invoke<SftpListResult>("resource_sftp_search", {
    ...invokeConnection(connection),
    path,
    query,
  });
}

export async function startSftpDownload(
  jobId: string,
  connection: SftpConnection,
  entry: SftpEntry,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("SFTP downloads require the desktop application.");
  }

  return invoke<boolean>("resource_sftp_start_download", {
    ...invokeConnection(connection),
    jobId,
    remotePath: entry.path,
    fileName: entry.name,
  });
}

export async function pauseSftpDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_sftp_pause", { jobId });
}

export async function cancelSftpDownload(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_sftp_cancel", { jobId });
}

export async function cleanupSftpTransfer(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_sftp_cleanup", { jobId });
}

export function sftpEntryIsBook(entry: SftpEntry): boolean {
  return !entry.isFolder && isSupportedResourceBook(entry.name);
}

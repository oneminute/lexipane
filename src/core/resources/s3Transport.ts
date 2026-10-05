import { invoke, isTauri } from "@tauri-apps/api/core";
import { isSupportedResourceBook } from "./bookFormats";

export interface S3Credentials {
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
}

export interface S3Connection extends S3Credentials {
  endpoint: string;
  region: string;
  bucket: string;
}

export interface S3Entry {
  id: string;
  name: string;
  key: string;
  size?: number;
  isFolder: boolean;
  modifiedAt?: string;
  etag?: string;
}

export interface S3ListResult {
  bucket: string;
  prefix: string;
  entries: S3Entry[];
  truncated: boolean;
}

function invokeConnection(connection: S3Connection) {
  return {
    endpoint: connection.endpoint,
    region: connection.region,
    bucket: connection.bucket,
    accessKey: connection.accessKey,
    secretKey: connection.secretKey,
    sessionToken: connection.sessionToken,
  };
}

export async function listS3Entries(
  connection: S3Connection,
  prefix?: string,
): Promise<S3ListResult> {
  if (!isTauri()) {
    throw new Error("S3 browsing requires the desktop application.");
  }

  return invoke<S3ListResult>("resource_s3_list", {
    ...invokeConnection(connection),
    prefix,
  });
}

export async function searchS3Entries(
  connection: S3Connection,
  query: string,
  prefix?: string,
): Promise<S3ListResult> {
  if (!isTauri()) {
    throw new Error("S3 search requires the desktop application.");
  }

  return invoke<S3ListResult>("resource_s3_search", {
    ...invokeConnection(connection),
    prefix,
    query,
  });
}

export async function startS3Download(
  jobId: string,
  connection: S3Connection,
  entry: S3Entry,
): Promise<boolean> {
  if (!isTauri()) {
    throw new Error("S3 downloads require the desktop application.");
  }

  return invoke<boolean>("resource_s3_start_download", {
    ...invokeConnection(connection),
    jobId,
    key: entry.key,
    fileName: entry.name,
  });
}

export async function pauseS3Download(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_s3_pause", { jobId });
}

export async function cancelS3Download(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_s3_cancel", { jobId });
}

export async function cleanupS3Transfer(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("resource_s3_cleanup", { jobId });
}

export function s3EntryIsBook(entry: S3Entry): boolean {
  return !entry.isFolder && isSupportedResourceBook(entry.name);
}

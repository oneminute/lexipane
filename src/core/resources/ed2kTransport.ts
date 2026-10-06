import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Ed2kConnectionConfig {
  executable?: string;
  host?: string;
  port?: number;
  password?: string;
  incomingDir?: string;
}

export interface Ed2kStatusResult {
  available: boolean;
  output: string;
}

export interface Ed2kEnvironment {
  installed: boolean;
  executable?: string;
  coreExecutable?: string;
  configPath?: string;
  configExists: boolean;
  incomingDir?: string;
  host: string;
  port: number;
  externalConnectionsEnabled: boolean;
}

export interface Ed2kAutoConfigureResult {
  environment: Ed2kEnvironment;
  available: boolean;
  started: boolean;
  restartRequired: boolean;
  status: string;
  warnings: string[];
}

export interface Ed2kLinkMetadata {
  name: string;
  size: number;
  hash: string;
  bookCandidate: boolean;
}

export interface Ed2kSearchResult {
  index: number;
  name: string;
  size?: number;
  sources?: number;
  bookCandidate: boolean;
}

export interface Ed2kSearchResponse {
  query: string;
  searchType: string;
  results: Ed2kSearchResult[];
  rawOutput: string;
}

export interface Ed2kStartResult {
  jobId: string;
  name: string;
  size?: number;
  hash?: string;
  started: boolean;
}

function requireDesktop() {
  if (!isTauri()) {
    throw new Error("ED2K sidecar control requires the desktop application.");
  }
}

export async function detectEd2kEnvironment(): Promise<Ed2kEnvironment> {
  requireDesktop();
  return invoke<Ed2kEnvironment>("resource_ed2k_detect");
}

export async function autoConfigureEd2k(
  password: string,
): Promise<Ed2kAutoConfigureResult> {
  requireDesktop();
  return invoke<Ed2kAutoConfigureResult>("resource_ed2k_auto_configure", {
    password,
  });
}

export async function getEd2kStatus(
  config: Ed2kConnectionConfig,
): Promise<Ed2kStatusResult> {
  requireDesktop();
  return invoke<Ed2kStatusResult>("resource_ed2k_status", { config });
}

export async function searchEd2k(
  config: Ed2kConnectionConfig,
  query: string,
  searchType: "global" | "kad" | "local" = "global",
): Promise<Ed2kSearchResponse> {
  requireDesktop();
  return invoke<Ed2kSearchResponse>("resource_ed2k_search", {
    config,
    query,
    searchType,
  });
}

export async function addEd2kLink(
  jobId: string,
  config: Ed2kConnectionConfig,
  link: string,
): Promise<Ed2kStartResult> {
  requireDesktop();
  return invoke<Ed2kStartResult>("resource_ed2k_add_link", {
    jobId,
    config,
    link,
  });
}

export async function downloadEd2kSearchResult(
  jobId: string,
  config: Ed2kConnectionConfig,
  result: Ed2kSearchResult,
): Promise<Ed2kStartResult> {
  requireDesktop();
  return invoke<Ed2kStartResult>("resource_ed2k_download_result", {
    jobId,
    config,
    resultIndex: result.index,
    name: result.name,
    size: result.size,
  });
}

export async function attachEd2kJob(
  jobId: string,
  config: Ed2kConnectionConfig,
  input: {
    name: string;
    size?: number;
    hash?: string;
    paused?: boolean;
  },
): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("resource_ed2k_attach", {
    jobId,
    config,
    name: input.name,
    size: input.size,
    hash: input.hash,
    paused: input.paused,
  });
}

export async function pauseEd2kJob(jobId: string): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("resource_ed2k_pause", { jobId });
}

export async function resumeEd2kJob(jobId: string): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("resource_ed2k_resume", { jobId });
}

export async function cancelEd2kJob(jobId: string): Promise<boolean> {
  requireDesktop();
  return invoke<boolean>("resource_ed2k_cancel", { jobId });
}

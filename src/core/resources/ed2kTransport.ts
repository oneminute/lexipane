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

export interface NativeEd2kSearchResult {
  hash: string;
  name: string;
  size: number;
  sources: number;
  completeSources: number;
  bookCandidate: boolean;
  ed2kLink: string;
  servers: string[];
}

export interface NativeEd2kSource {
  address?: string | null;
  tcpPort: number;
  udpPort?: number | null;
  origin: string;
  direct: boolean;
  lowId: boolean;
  clientId?: number | null;
  server?: string | null;
  sourceType?: number | null;
  encryption?: number | null;
}

export interface NativeEd2kSourceDiscoveryResponse {
  hash: string;
  size: number;
  serverListSource: string;
  serversLoaded: number;
  serversQueried: number;
  serversResponded: number;
  kadNodesSource?: string | null;
  kadContactsLoaded: number;
  kadContactsDiscovered: number;
  kadBootstrapQueried: number;
  kadBootstrapResponded: number;
  kadLookupQueried: number;
  kadLookupResponded: number;
  kadSourceQueried: number;
  kadSourceResponded: number;
  searchPhase: string;
  sources: NativeEd2kSource[];
  errors: string[];
}

export interface NativeEd2kSearchResponse {
  query: string;
  serverListSource: string;
  serversLoaded: number;
  serversQueried: number;
  serversSucceeded: number;
  tcpServersQueried: number;
  tcpServersSucceeded: number;
  globalServersQueried: number;
  globalServersResponded: number;
  kadNodesSource?: string | null;
  kadContactsLoaded: number;
  kadContactsDiscovered: number;
  kadBootstrapQueried: number;
  kadBootstrapResponded: number;
  kadLookupQueried: number;
  kadLookupResponded: number;
  kadKeywordQueried: number;
  kadKeywordResponded: number;
  searchPhase: string;
  results: NativeEd2kSearchResult[];
  errors: string[];
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

export async function searchNativeEd2k(
  query: string,
  maxServers = 6,
): Promise<NativeEd2kSearchResponse> {
  requireDesktop();
  return invoke<NativeEd2kSearchResponse>(
    "resource_ed2k_native_search",
    {
      query,
      maxServers,
    },
  );
}

export async function discoverNativeEd2kSources(
  result: Pick<NativeEd2kSearchResult, "hash" | "size">,
  maxServers = 6,
): Promise<NativeEd2kSourceDiscoveryResponse> {
  requireDesktop();
  return invoke<NativeEd2kSourceDiscoveryResponse>(
    "resource_ed2k_native_discover_sources",
    {
      hash: result.hash,
      size: result.size,
      maxServers,
    },
  );
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

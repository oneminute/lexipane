export type ResourceProviderKind =
  | "catalog"
  | "storage"
  | "p2p"
  | "transport";

export type ResourcePreviewLevel = 0 | 1 | 2 | 3;

export interface ResourceProviderCapabilities {
  search?: boolean;
  browse?: boolean;
  resolve?: boolean;
  preview?: boolean;
  previewLevels?: ResourcePreviewLevel[];
  fileList?: boolean;
  download?: boolean;
  stream?: boolean;
  upload?: boolean;
  authentication?: boolean;
}

export interface ResourceProviderDescriptor {
  id: string;
  name: string;
  kind: ResourceProviderKind;
  description: string;
  capabilities: ResourceProviderCapabilities;
  builtin: boolean;
  live: boolean;
}

export type ResourceRightsStatus =
  | "public-domain"
  | "user-owned"
  | "authorized"
  | "unknown";

export interface ResourceIdentifiers {
  isbn?: string;
  doi?: string;
  sha256?: string;
  btih?: string;
  btmh?: string;
  ed2kHash?: string;
  providerVersionId?: string;
}

export interface ResourceAvailability {
  sourceCount?: number;
  peers?: number;
  seeders?: number;
  remoteAvailable?: boolean;
}

export interface ResourceMetadata {
  language?: string;
  publisher?: string;
  year?: number;
  edition?: string;
  coverUrl?: string;
  [key: string]: unknown;
}

export interface ResourceItem {
  id: string;
  title: string;
  authors: string[];
  description?: string;
  identifiers?: ResourceIdentifiers;
  availability?: ResourceAvailability;
  metadata?: ResourceMetadata;
  rightsStatus: ResourceRightsStatus;
  createdAt: string;
  updatedAt: string;
}

export type ResourceSourceType =
  | "catalog"
  | "cloud"
  | "http"
  | "p2p"
  | "local"
  | "other";

export interface ResourceSource {
  id: string;
  resourceItemId: string;
  providerId: string;
  sourceKey: string;
  sourceType: ResourceSourceType;
  uri?: string;
  metadata?: Record<string, unknown>;
  availability?: ResourceAvailability;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceFile {
  id: string;
  resourceItemId: string;
  sourceId?: string;
  name: string;
  relativePath?: string;
  sizeBytes?: number;
  mimeType?: string;
  extension?: string;
  identifiers?: ResourceIdentifiers;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type TransferJobState =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "downloaded"
  | "ingesting"
  | "completed"
  | "failed"
  | "canceled";

export interface TransferJob {
  id: string;
  resourceItemId?: string;
  sourceId?: string;
  fileId?: string;
  providerId: string;
  transportType: string;
  state: TransferJobState;
  progress: number;
  bytesTotal?: number;
  bytesCompleted: number;
  downloadRate?: number;
  uploadRate?: number;
  error?: string;
  temporaryPath?: string;
  destinationPath?: string;
  resumeData?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type ResourceInputKind =
  | "http"
  | "opds"
  | "google-drive"
  | "dropbox"
  | "onedrive"
  | "magnet"
  | "torrent"
  | "ed2k"
  | "webdav"
  | "s3"
  | "sftp"
  | "unknown";

export interface ResourceInputClassification {
  kind: ResourceInputKind;
  normalizedInput: string;
  providerHint?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  startsNetworkActivity: false;
}

export interface ResourceNativeCapabilities {
  coreVersion: number;
  persistentJobs: boolean;
  directTransferConcurrency: number;
  liveTransports: {
    http: boolean;
    torrent: boolean;
    ed2k: boolean;
    cloud: boolean;
    webdav: boolean;
    s3: boolean;
  };
}

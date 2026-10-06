import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import { BUILTIN_RESOURCE_PROVIDERS } from "./registry";
import type {
  ResourceFile,
  ResourceItem,
  ResourceProviderCapabilities,
  ResourceProviderKind,
  ResourceSource,
  TransferJob,
} from "./types";

interface ResourceProviderRow {
  id: string;
  kind: ResourceProviderKind;
  display_name: string;
  enabled: number;
  builtin: number;
  live: number;
  capabilities_json: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

interface ResourceAccountRow {
  id: string;
  provider_id: string;
  external_account_id: string | null;
  display_name: string | null;
  status: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface ResourceItemRow {
  id: string;
  title: string;
  authors_json: string;
  description: string | null;
  identifiers_json: string;
  availability_json: string;
  metadata_json: string;
  rights_status: ResourceItem["rightsStatus"];
  created_at: string;
  updated_at: string;
}

interface ResourceSourceRow {
  id: string;
  resource_item_id: string;
  provider_id: string;
  source_key: string;
  source_type: ResourceSource["sourceType"];
  uri: string | null;
  metadata_json: string;
  availability_json: string;
  created_at: string;
  updated_at: string;
}

interface ResourceFileRow {
  id: string;
  resource_item_id: string;
  source_id: string | null;
  name: string;
  relative_path: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  extension: string | null;
  identifiers_json: string;
  metadata_json: string;
  created_at: string;
}

interface ResourceCatalogRow {
  id: string;
  provider_id: string;
  name: string;
  url: string;
  enabled: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface TransferJobRow {
  id: string;
  resource_item_id: string | null;
  source_id: string | null;
  file_id: string | null;
  provider_id: string;
  transport_type: string;
  state: TransferJob["state"];
  progress: number;
  bytes_total: number | null;
  bytes_completed: number;
  download_rate: number | null;
  upload_rate: number | null;
  error: string | null;
  temporary_path: string | null;
  destination_path: string | null;
  resume_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface PersistedResourceProvider {
  id: string;
  kind: ResourceProviderKind;
  displayName: string;
  enabled: boolean;
  builtin: boolean;
  live: boolean;
  capabilities: ResourceProviderCapabilities;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceAccount {
  id: string;
  providerId: string;
  externalAccountId?: string;
  displayName?: string;
  status: "connected" | "disconnected" | "error";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceCatalog {
  id: string;
  providerId: string;
  name: string;
  url: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceBundle {
  item: ResourceItem;
  sources: ResourceSource[];
  files: ResourceFile[];
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nullable<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function providerFromRow(row: ResourceProviderRow): PersistedResourceProvider {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    enabled: row.enabled !== 0,
    builtin: row.builtin !== 0,
    live: row.live !== 0,
    capabilities: parseJson<ResourceProviderCapabilities>(
      row.capabilities_json,
      {},
    ),
    config: parseJson<Record<string, unknown>>(row.config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function accountFromRow(row: ResourceAccountRow): ResourceAccount {
  return {
    id: row.id,
    providerId: row.provider_id,
    externalAccountId: nullable(row.external_account_id),
    displayName: nullable(row.display_name),
    status:
      row.status === "connected" || row.status === "error"
        ? row.status
        : "disconnected",
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: ResourceItemRow): ResourceItem {
  return {
    id: row.id,
    title: row.title,
    authors: parseJson<string[]>(row.authors_json, []),
    description: nullable(row.description),
    identifiers: parseJson(row.identifiers_json, {}),
    availability: parseJson(row.availability_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    rightsStatus: row.rights_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceFromRow(row: ResourceSourceRow): ResourceSource {
  return {
    id: row.id,
    resourceItemId: row.resource_item_id,
    providerId: row.provider_id,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    uri: nullable(row.uri),
    metadata: parseJson(row.metadata_json, {}),
    availability: parseJson(row.availability_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fileFromRow(row: ResourceFileRow): ResourceFile {
  return {
    id: row.id,
    resourceItemId: row.resource_item_id,
    sourceId: nullable(row.source_id),
    name: row.name,
    relativePath: nullable(row.relative_path),
    sizeBytes: nullable(row.size_bytes),
    mimeType: nullable(row.mime_type),
    extension: nullable(row.extension),
    identifiers: parseJson(row.identifiers_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function catalogFromRow(row: ResourceCatalogRow): ResourceCatalog {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    url: row.url,
    enabled: row.enabled !== 0,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function transferFromRow(row: TransferJobRow): TransferJob {
  return {
    id: row.id,
    resourceItemId: nullable(row.resource_item_id),
    sourceId: nullable(row.source_id),
    fileId: nullable(row.file_id),
    providerId: row.provider_id,
    transportType: row.transport_type,
    state: row.state,
    progress: row.progress,
    bytesTotal: nullable(row.bytes_total),
    bytesCompleted: row.bytes_completed,
    downloadRate: nullable(row.download_rate),
    uploadRate: nullable(row.upload_rate),
    error: nullable(row.error),
    temporaryPath: nullable(row.temporary_path),
    destinationPath: nullable(row.destination_path),
    resumeData: parseJson(row.resume_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: nullable(row.started_at),
    completedAt: nullable(row.completed_at),
  };
}

export function createResourceRecordId(prefix: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

  return prefix + ":" + suffix;
}

export async function syncBuiltinResourceProviders(): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const now = new Date().toISOString();

  for (const provider of BUILTIN_RESOURCE_PROVIDERS) {
    await db.execute(
      "INSERT INTO resource_providers " +
        "(id, kind, display_name, enabled, builtin, live, capabilities_json, config_json, created_at, updated_at) " +
        "VALUES ($1, $2, $3, 1, 1, $4, $5, '{}', $6, $6) " +
        "ON CONFLICT(id) DO UPDATE SET " +
        "kind = excluded.kind, display_name = excluded.display_name, " +
        "builtin = 1, live = excluded.live, " +
        "capabilities_json = excluded.capabilities_json, updated_at = excluded.updated_at",
      [
        provider.id,
        provider.kind,
        provider.name,
        provider.live ? 1 : 0,
        JSON.stringify(provider.capabilities),
        now,
      ],
    );
  }
}

export async function listResourceAccounts(): Promise<
  ResourceAccount[]
> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<ResourceAccountRow[]>(
    "SELECT * FROM resource_accounts ORDER BY updated_at DESC",
  );

  return rows.map(accountFromRow);
}

export async function saveResourceAccount(
  input: {
    id?: string;
    providerId: string;
    displayName?: string;
    externalAccountId?: string;
    status?: ResourceAccount["status"];
    metadata?: Record<string, unknown>;
  },
): Promise<ResourceAccount | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const id = input.id ?? createResourceRecordId("account");
  const now = new Date().toISOString();
  const existing = await db.select<ResourceAccountRow[]>(
    "SELECT * FROM resource_accounts WHERE id = $1 LIMIT 1",
    [id],
  );

  if (existing[0]) {
    const current = accountFromRow(existing[0]);
    const next: ResourceAccount = {
      ...current,
      providerId: input.providerId || current.providerId,
      displayName:
        input.displayName === undefined
          ? current.displayName
          : input.displayName,
      externalAccountId:
        input.externalAccountId === undefined
          ? current.externalAccountId
          : input.externalAccountId,
      status: input.status ?? current.status,
      metadata: input.metadata ?? current.metadata,
      updatedAt: now,
    };

    await db.execute(
      "UPDATE resource_accounts SET provider_id=$2, external_account_id=$3, display_name=$4, status=$5, metadata_json=$6, updated_at=$7 WHERE id=$1",
      [
        id,
        next.providerId,
        next.externalAccountId ?? null,
        next.displayName ?? null,
        next.status,
        JSON.stringify(next.metadata),
        now,
      ],
    );

    return next;
  }

  const created: ResourceAccount = {
    id,
    providerId: input.providerId,
    externalAccountId: input.externalAccountId,
    displayName: input.displayName,
    status: input.status ?? "connected",
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  await db.execute(
    "INSERT INTO resource_accounts " +
      "(id, provider_id, external_account_id, display_name, status, metadata_json, created_at, updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
    [
      created.id,
      created.providerId,
      created.externalAccountId ?? null,
      created.displayName ?? null,
      created.status,
      JSON.stringify(created.metadata),
      now,
    ],
  );

  return created;
}

export async function deleteResourceAccount(
  accountId: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "DELETE FROM resource_accounts WHERE id = $1",
    [accountId],
  );
}

export async function listPersistedResourceProviders(): Promise<
  PersistedResourceProvider[]
> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<ResourceProviderRow[]>(
    "SELECT * FROM resource_providers ORDER BY builtin DESC, display_name ASC",
  );

  return rows.map(providerFromRow);
}

export async function saveResourceBundle(
  bundle: ResourceBundle,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const { item } = bundle;

  // These upserts are intentionally autocommitted one statement at a time.
  // plugin-sql uses a connection pool, so a frontend BEGIN/COMMIT sequence
  // across multiple execute() calls can switch connections and retain a
  // SQLite write lock. Every statement here is idempotent, so a retry after
  // interruption safely completes a partially persisted bundle.
  await db.execute(
    "INSERT INTO resource_items " +
      "(id, title, authors_json, description, identifiers_json, availability_json, metadata_json, rights_status, created_at, updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "title=excluded.title, authors_json=excluded.authors_json, description=excluded.description, " +
      "identifiers_json=excluded.identifiers_json, availability_json=excluded.availability_json, " +
      "metadata_json=excluded.metadata_json, rights_status=excluded.rights_status, updated_at=excluded.updated_at",
    [
      item.id,
      item.title,
      JSON.stringify(item.authors),
      item.description ?? null,
      JSON.stringify(item.identifiers ?? {}),
      JSON.stringify(item.availability ?? {}),
      JSON.stringify(item.metadata ?? {}),
      item.rightsStatus,
      item.createdAt,
      item.updatedAt,
    ],
  );

  for (const source of bundle.sources) {
    await db.execute(
      "INSERT INTO resource_sources " +
        "(id, resource_item_id, provider_id, source_key, source_type, uri, metadata_json, availability_json, created_at, updated_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
        "ON CONFLICT(id) DO UPDATE SET " +
        "resource_item_id=excluded.resource_item_id, provider_id=excluded.provider_id, source_key=excluded.source_key, " +
        "source_type=excluded.source_type, uri=excluded.uri, metadata_json=excluded.metadata_json, " +
        "availability_json=excluded.availability_json, updated_at=excluded.updated_at",
      [
        source.id,
        source.resourceItemId,
        source.providerId,
        source.sourceKey,
        source.sourceType,
        source.uri ?? null,
        JSON.stringify(source.metadata ?? {}),
        JSON.stringify(source.availability ?? {}),
        source.createdAt,
        source.updatedAt,
      ],
    );
  }

  for (const file of bundle.files) {
    await db.execute(
      "INSERT INTO resource_files " +
        "(id, resource_item_id, source_id, name, relative_path, size_bytes, mime_type, extension, identifiers_json, metadata_json, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) " +
        "ON CONFLICT(id) DO UPDATE SET " +
        "resource_item_id=excluded.resource_item_id, source_id=excluded.source_id, name=excluded.name, " +
        "relative_path=excluded.relative_path, size_bytes=excluded.size_bytes, mime_type=excluded.mime_type, " +
        "extension=excluded.extension, identifiers_json=excluded.identifiers_json, metadata_json=excluded.metadata_json",
      [
        file.id,
        file.resourceItemId,
        file.sourceId ?? null,
        file.name,
        file.relativePath ?? null,
        file.sizeBytes ?? null,
        file.mimeType ?? null,
        file.extension ?? null,
        JSON.stringify(file.identifiers ?? {}),
        JSON.stringify(file.metadata ?? {}),
        file.createdAt,
      ],
    );
  }
}

export async function listResourceItems(
  limit = 100,
): Promise<ResourceItem[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.select<ResourceItemRow[]>(
    "SELECT * FROM resource_items ORDER BY updated_at DESC LIMIT $1",
    [safeLimit],
  );

  return rows.map(itemFromRow);
}

export async function getResourceBundle(
  resourceItemId: string,
): Promise<ResourceBundle | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const [itemRows, sourceRows, fileRows] = await Promise.all([
    db.select<ResourceItemRow[]>(
      "SELECT * FROM resource_items WHERE id = $1 LIMIT 1",
      [resourceItemId],
    ),
    db.select<ResourceSourceRow[]>(
      "SELECT * FROM resource_sources WHERE resource_item_id = $1 ORDER BY created_at ASC",
      [resourceItemId],
    ),
    db.select<ResourceFileRow[]>(
      "SELECT * FROM resource_files WHERE resource_item_id = $1 ORDER BY name ASC",
      [resourceItemId],
    ),
  ]);

  const item = itemRows[0];
  if (!item) return null;

  return {
    item: itemFromRow(item),
    sources: sourceRows.map(sourceFromRow),
    files: fileRows.map(fileFromRow),
  };
}

export async function listResourceCatalogs(): Promise<
  ResourceCatalog[]
> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<ResourceCatalogRow[]>(
    "SELECT * FROM resource_catalogs WHERE enabled = 1 ORDER BY name ASC",
  );

  return rows.map(catalogFromRow);
}

export async function saveResourceCatalog(
  name: string,
  url: string,
  metadata: Record<string, unknown> = {},
  providerId = "opds",
): Promise<ResourceCatalog | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const normalizedName = name.trim() || "OPDS catalog";
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    throw new Error("Catalog URL is required.");
  }

  const existing = await db.select<ResourceCatalogRow[]>(
    "SELECT * FROM resource_catalogs WHERE url = $1 LIMIT 1",
    [normalizedUrl],
  );
  const now = new Date().toISOString();

  if (existing[0]) {
    await db.execute(
      "UPDATE resource_catalogs SET provider_id = $2, name = $3, enabled = 1, metadata_json = $4, updated_at = $5 WHERE id = $1",
      [
        existing[0].id,
        providerId,
        normalizedName,
        JSON.stringify(metadata),
        now,
      ],
    );

    return {
      ...catalogFromRow(existing[0]),
      name: normalizedName,
      enabled: true,
      metadata,
      updatedAt: now,
    };
  }

  const id = createResourceRecordId("catalog");

  await db.execute(
    "INSERT INTO resource_catalogs " +
      "(id, provider_id, name, url, enabled, metadata_json, created_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, 1, $5, $6, $6)",
    [
      id,
      providerId,
      normalizedName,
      normalizedUrl,
      JSON.stringify(metadata),
      now,
    ],
  );

  return {
    id,
    providerId,
    name: normalizedName,
    url: normalizedUrl,
    enabled: true,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

export async function removeResourceCatalog(
  catalogId: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "DELETE FROM resource_catalogs WHERE id = $1",
    [catalogId],
  );
}

export async function findResourceBundleBySource(
  providerId: string,
  sourceKey: string,
): Promise<ResourceBundle | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<Array<{ resource_item_id: string }>>(
    "SELECT resource_item_id FROM resource_sources " +
      "WHERE provider_id = $1 AND source_key = $2 LIMIT 1",
    [providerId, sourceKey],
  );

  const resourceItemId = rows[0]?.resource_item_id;
  return resourceItemId
    ? getResourceBundle(resourceItemId)
    : null;
}

export interface CreateTransferJobInput {
  providerId: string;
  transportType: string;
  resourceItemId?: string;
  sourceId?: string;
  fileId?: string;
  destinationPath?: string;
  resumeData?: Record<string, unknown>;
}

export async function createDraftTransferJob(
  input: CreateTransferJobInput,
): Promise<TransferJob | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const id = createResourceRecordId("transfer");
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO transfer_jobs " +
      "(id, resource_item_id, source_id, file_id, provider_id, transport_type, state, progress, bytes_completed, destination_path, resume_json, created_at, updated_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,'draft',0,0,$7,$8,$9,$9)",
    [
      id,
      input.resourceItemId ?? null,
      input.sourceId ?? null,
      input.fileId ?? null,
      input.providerId,
      input.transportType,
      input.destinationPath ?? null,
      JSON.stringify(input.resumeData ?? {}),
      now,
    ],
  );

  return {
    id,
    resourceItemId: input.resourceItemId,
    sourceId: input.sourceId,
    fileId: input.fileId,
    providerId: input.providerId,
    transportType: input.transportType,
    state: "draft",
    progress: 0,
    bytesCompleted: 0,
    destinationPath: input.destinationPath,
    resumeData: input.resumeData ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

export async function listTransferJobs(): Promise<TransferJob[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  const rows = await db.select<TransferJobRow[]>(
    "SELECT * FROM transfer_jobs ORDER BY created_at DESC",
  );

  return rows.map(transferFromRow);
}


export interface TransferProgressUpdate {
  state: TransferJob["state"];
  progress?: number;
  bytesTotal?: number;
  bytesCompleted?: number;
  downloadRate?: number;
  uploadRate?: number;
  error?: string | null;
  temporaryPath?: string | null;
  destinationPath?: string | null;
  resumeData?: Record<string, unknown>;
  startedAt?: string | null;
  completedAt?: string | null;
}

export async function updateTransferJob(
  jobId: string,
  update: TransferProgressUpdate,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const currentRows = await db.select<TransferJobRow[]>(
    "SELECT * FROM transfer_jobs WHERE id = $1 LIMIT 1",
    [jobId],
  );
  const current = currentRows[0];

  if (!current) {
    throw new Error("Transfer job not found: " + jobId);
  }

  const nextResume =
    update.resumeData === undefined
      ? current.resume_json
      : JSON.stringify(update.resumeData);
  const now = new Date().toISOString();

  await db.execute(
    "UPDATE transfer_jobs SET " +
      "state=$2, progress=$3, bytes_total=$4, bytes_completed=$5, " +
      "download_rate=$6, upload_rate=$7, error=$8, temporary_path=$9, " +
      "destination_path=$10, resume_json=$11, updated_at=$12, " +
      "started_at=$13, completed_at=$14 WHERE id=$1",
    [
      jobId,
      update.state,
      update.progress ?? current.progress,
      update.bytesTotal ?? current.bytes_total,
      update.bytesCompleted ?? current.bytes_completed,
      update.downloadRate ?? current.download_rate,
      update.uploadRate ?? current.upload_rate,
      update.error === undefined ? current.error : update.error,
      update.temporaryPath === undefined
        ? current.temporary_path
        : update.temporaryPath,
      update.destinationPath === undefined
        ? current.destination_path
        : update.destinationPath,
      nextResume,
      now,
      update.startedAt === undefined
        ? update.state === "running" && !current.started_at
          ? now
          : current.started_at
        : update.startedAt,
      update.completedAt === undefined
        ? current.completed_at
        : update.completedAt,
    ],
  );
}

export async function getTransferJob(
  jobId: string,
): Promise<TransferJob | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<TransferJobRow[]>(
    "SELECT * FROM transfer_jobs WHERE id = $1 LIMIT 1",
    [jobId],
  );

  return rows[0] ? transferFromRow(rows[0]) : null;
}

export async function resetTransferJobForRetry(
  jobId: string,
): Promise<void> {
  const job = await getTransferJob(jobId);
  if (!job) {
    throw new Error("Transfer job not found: " + jobId);
  }

  await updateTransferJob(jobId, {
    state: "queued",
    error: null,
    progress: job.progress,
    bytesTotal: job.bytesTotal,
    bytesCompleted: job.bytesCompleted,
    downloadRate: 0,
    completedAt: null,
  });
}


export async function recordResourceContentHash(
  resourceItemId: string | undefined,
  fileId: string | undefined,
  sha256: string,
): Promise<void> {
  if (!isTauri() || !resourceItemId || !sha256.trim()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const itemRows = await db.select<Array<{ identifiers_json: string }>>(
    "SELECT identifiers_json FROM resource_items WHERE id = $1 LIMIT 1",
    [resourceItemId],
  );
  const itemIdentifiers = parseJson<Record<string, unknown>>(
    itemRows[0]?.identifiers_json ?? "{}",
    {},
  );
  itemIdentifiers.sha256 = sha256.trim().toLowerCase();

  await db.execute(
    "UPDATE resource_items SET identifiers_json = $2, updated_at = $3 WHERE id = $1",
    [
      resourceItemId,
      JSON.stringify(itemIdentifiers),
      new Date().toISOString(),
    ],
  );

  if (!fileId) return;

  const fileRows = await db.select<Array<{ identifiers_json: string }>>(
    "SELECT identifiers_json FROM resource_files WHERE id = $1 LIMIT 1",
    [fileId],
  );
  const fileIdentifiers = parseJson<Record<string, unknown>>(
    fileRows[0]?.identifiers_json ?? "{}",
    {},
  );
  fileIdentifiers.sha256 = sha256.trim().toLowerCase();

  await db.execute(
    "UPDATE resource_files SET identifiers_json = $2 WHERE id = $1",
    [fileId, JSON.stringify(fileIdentifiers)],
  );
}

export async function appendResourceHistory(
  resourceItemId: string | undefined,
  providerId: string | undefined,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "INSERT INTO resource_history " +
      "(id, resource_item_id, provider_id, action, details_json, created_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6)",
    [
      createResourceRecordId("history"),
      resourceItemId ?? null,
      providerId ?? null,
      action,
      JSON.stringify(details),
      new Date().toISOString(),
    ],
  );
}


export async function deleteTransferJob(
  jobId: string,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  const rows = await db.select<Array<{ state: string }>>(
    "SELECT state FROM transfer_jobs WHERE id = $1 LIMIT 1",
    [jobId],
  );
  const state = rows[0]?.state;

  if (
    state &&
    !["completed", "canceled", "failed", "draft"].includes(state)
  ) {
    throw new Error(
      "Active transfer jobs must be paused or canceled before removal.",
    );
  }

  await db.execute(
    "DELETE FROM transfer_files WHERE transfer_job_id = $1",
    [jobId],
  );
  await db.execute(
    "DELETE FROM transfer_jobs WHERE id = $1",
    [jobId],
  );
}

export async function clearFinishedTransferJobs(): Promise<number> {
  if (!isTauri()) return 0;

  const db = await initializeDatabase();
  if (!db) return 0;

  const rows = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM transfer_jobs " +
      "WHERE state IN ('completed','canceled')",
  );
  const count = Number(rows[0]?.count ?? 0);

  await db.execute(
    "DELETE FROM transfer_files WHERE transfer_job_id IN (" +
      "SELECT id FROM transfer_jobs WHERE state IN ('completed','canceled')" +
      ")",
  );
  await db.execute(
    "DELETE FROM transfer_jobs WHERE state IN ('completed','canceled')",
  );

  return count;
}

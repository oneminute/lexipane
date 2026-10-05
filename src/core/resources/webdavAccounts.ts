import {
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";
import {
  cancelWebDavDownload,
  cleanupWebDavTransfer,
  listWebDavEntries,
  pauseWebDavDownload,
  startWebDavDownload,
  webDavEntryIsBook,
  type WebDavConnection,
  type WebDavEntry,
  type WebDavListResult,
} from "./webdavTransport";
import {
  createDraftTransferJob,
  createResourceRecordId,
  deleteResourceAccount,
  findResourceBundleBySource,
  getTransferJob,
  listResourceAccounts,
  resetTransferJobForRetry,
  saveResourceAccount,
  saveResourceBundle,
  updateTransferJob,
  type ResourceAccount,
  type ResourceBundle,
} from "./persistence";
import {
  deleteResourceAccountToken,
  getResourceAccountToken,
  setResourceAccountToken,
} from "./resourceSecretStore";
import type {
  ResourceFile,
  ResourceItem,
  ResourceSource,
  TransferJob,
} from "./types";

export interface ConnectedWebDavAccount extends ResourceAccount {
  providerId: "webdav";
}

export interface WebDavAccountInput {
  displayName?: string;
  baseUrl: string;
  username?: string;
  password?: string;
}

function metadataConnection(
  account: ConnectedWebDavAccount,
  password?: string,
): WebDavConnection {
  const baseUrl =
    typeof account.metadata.baseUrl === "string"
      ? account.metadata.baseUrl
      : "";
  const username =
    typeof account.metadata.username === "string"
      ? account.metadata.username
      : "";

  return {
    baseUrl,
    username,
    password,
  };
}

async function accountConnection(
  account: ConnectedWebDavAccount,
): Promise<WebDavConnection> {
  const password = await getResourceAccountToken("webdav", account.id);

  return metadataConnection(account, password ?? undefined);
}

export async function listWebDavAccounts(): Promise<
  ConnectedWebDavAccount[]
> {
  return (await listResourceAccounts()).filter(
    (account): account is ConnectedWebDavAccount =>
      account.providerId === "webdav" &&
      account.status === "connected",
  );
}

export async function connectWebDavAccount(
  input: WebDavAccountInput,
): Promise<ConnectedWebDavAccount> {
  const baseUrl = input.baseUrl.trim();
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";

  if (!baseUrl) {
    throw new Error("WebDAV / Nextcloud URL is required.");
  }

  const testConnection: WebDavConnection = {
    baseUrl,
    username,
    password: password || undefined,
  };
  const root = await listWebDavEntries(testConnection);

  const saved = await saveResourceAccount({
    providerId: "webdav",
    displayName:
      input.displayName?.trim() ||
      (() => {
        try {
          return new URL(root.baseUrl).hostname;
        } catch {
          return "WebDAV";
        }
      })(),
    status: "connected",
    metadata: {
      baseUrl: root.baseUrl,
      username,
      connectionMode: "basic-auth",
    },
  });

  if (!saved) {
    throw new Error("Unable to persist the WebDAV account.");
  }

  try {
    if (password) {
      await setResourceAccountToken("webdav", saved.id, password);
    }
  } catch (error) {
    await deleteResourceAccount(saved.id).catch(() => undefined);
    throw error;
  }

  return saved as ConnectedWebDavAccount;
}

export async function disconnectWebDavAccount(
  account: ConnectedWebDavAccount,
): Promise<void> {
  await deleteResourceAccountToken("webdav", account.id).catch(
    () => undefined,
  );
  await deleteResourceAccount(account.id);
}

export async function browseWebDavAccount(
  account: ConnectedWebDavAccount,
  path?: string,
): Promise<WebDavListResult> {
  return listWebDavEntries(await accountConnection(account), path);
}

export async function searchWebDavAccount(
  account: ConnectedWebDavAccount,
  query: string,
  startPath?: string,
  maxFolders = 40,
): Promise<WebDavListResult> {
  const connection = await accountConnection(account);
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return listWebDavEntries(connection, startPath);
  }

  const root = await listWebDavEntries(connection, startPath);
  const matches: WebDavEntry[] = [];
  const queue = root.entries
    .filter((entry) => entry.isFolder)
    .map((entry) => entry.href);
  const seen = new Set<string>([root.path]);
  let visited = 0;

  for (const entry of root.entries) {
    if (
      !entry.isFolder &&
      entry.name.toLowerCase().includes(normalizedQuery)
    ) {
      matches.push(entry);
    }
  }

  while (queue.length > 0 && visited < maxFolders) {
    const next = queue.shift();
    if (!next || seen.has(next)) continue;

    seen.add(next);
    visited += 1;

    let listing: WebDavListResult;
    try {
      listing = await listWebDavEntries(connection, next);
    } catch {
      continue;
    }

    for (const entry of listing.entries) {
      if (entry.isFolder) {
        if (!seen.has(entry.href)) queue.push(entry.href);
        continue;
      }

      if (entry.name.toLowerCase().includes(normalizedQuery)) {
        matches.push(entry);
      }
    }
  }

  return {
    baseUrl: root.baseUrl,
    path: root.path,
    entries: matches,
  };
}

function extension(
  name: string,
  mimeType?: string,
): string | undefined {
  return supportedResourceBookFormat(name, mimeType) ?? undefined;
}

function title(name: string): string {
  return stripSupportedBookExtension(name);
}

async function prepareWebDavResource(
  account: ConnectedWebDavAccount,
  entry: WebDavEntry,
): Promise<ResourceBundle> {
  if (!webDavEntryIsBook(entry)) {
    throw new Error(
      "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 files from WebDAV.",
    );
  }

  const sourceKey = account.id + ":" + entry.href;
  const existing = await findResourceBundleBySource(
    "webdav",
    sourceKey,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");

  const item: ResourceItem = {
    id: itemId,
    title: title(entry.name),
    authors: [],
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      webDavAccountId: account.id,
      modifiedAt: entry.modifiedAt,
    },
    rightsStatus: "user-owned",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "webdav",
    sourceKey,
    sourceType: "cloud",
    uri: entry.href,
    metadata: {
      accountId: account.id,
      modifiedAt: entry.modifiedAt,
    },
    availability: {
      remoteAvailable: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  const file: ResourceFile = {
    id: fileId,
    resourceItemId: itemId,
    sourceId,
    name: entry.name,
    sizeBytes: entry.size,
    mimeType: entry.mimeType,
    extension: extension(entry.name, entry.mimeType),
    identifiers: {
      providerVersionId:
        entry.modifiedAt
          ? entry.href + "@" + entry.modifiedAt
          : entry.href,
    },
    metadata: {},
    createdAt: now,
  };

  const bundle = {
    item,
    sources: [source],
    files: [file],
  };

  await saveResourceBundle(bundle);
  return bundle;
}

export async function startWebDavEntryAcquisition(
  account: ConnectedWebDavAccount,
  entry: WebDavEntry,
): Promise<TransferJob> {
  const connection = await accountConnection(account);
  const bundle = await prepareWebDavResource(account, entry);
  const source = bundle.sources[0];
  const file = bundle.files[0];

  if (!source || !file) {
    throw new Error("WebDAV resource persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: "webdav",
    transportType: "webdav",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      webDavAccountId: account.id,
      resourceInput: entry.href,
      fileUrl: entry.href,
      fileName: entry.name,
    },
  });

  if (!job) throw new Error("Unable to create WebDAV transfer job.");

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: entry.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await startWebDavDownload(job.id, connection, entry);
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start WebDAV transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

  return (await getTransferJob(job.id)) ?? {
    ...job,
    state: "queued",
    bytesTotal: entry.size,
  };
}

async function accountForJob(
  job: TransferJob,
): Promise<ConnectedWebDavAccount> {
  const id =
    typeof job.resumeData?.webDavAccountId === "string"
      ? job.resumeData.webDavAccountId
      : "";

  const account = (await listWebDavAccounts()).find(
    (item) => item.id === id,
  );
  if (!account) {
    throw new Error(
      "The WebDAV account for this transfer is no longer configured.",
    );
  }

  return account;
}

export async function resumeWebDavTransfer(
  job: TransferJob,
): Promise<void> {
  const account = await accountForJob(job);
  const connection = await accountConnection(account);
  const fileUrl =
    typeof job.resumeData?.fileUrl === "string"
      ? job.resumeData.fileUrl
      : "";
  const fileName =
    typeof job.resumeData?.fileName === "string"
      ? job.resumeData.fileName
      : "download";

  if (!fileUrl) {
    throw new Error("The WebDAV transfer is missing its source URL.");
  }

  await resetTransferJobForRetry(job.id);

  try {
    await startWebDavDownload(
      job.id,
      connection,
      {
        id: fileUrl,
        name: fileName,
        href: fileUrl,
        isFolder: false,
      },
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to resume WebDAV transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardWebDavTransfer(
  job: TransferJob,
): Promise<void> {
  await cleanupWebDavTransfer(job.id).catch(() => undefined);
  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export {
  pauseWebDavDownload,
  cancelWebDavDownload,
};

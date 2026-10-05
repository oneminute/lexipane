import {
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";
import {
  cancelCloudDownload,
  cleanupCloudTransfer,
  cloudEntryIsBook,
  listCloudEntries,
  pauseCloudDownload,
  searchCloudEntries,
  startCloudDownload,
  type CloudEntry,
  type CloudListResult,
  type CloudProviderId,
} from "./cloudTransport";
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

export interface ConnectedCloudAccount extends ResourceAccount {
  providerId: CloudProviderId;
}

function isCloudProvider(
  value: string,
): value is CloudProviderId {
  return (
    value === "google-drive" ||
    value === "dropbox" ||
    value === "onedrive"
  );
}

export async function listConnectedCloudAccounts(): Promise<
  ConnectedCloudAccount[]
> {
  const accounts = await listResourceAccounts();

  return accounts.filter(
    (account): account is ConnectedCloudAccount =>
      isCloudProvider(account.providerId) &&
      account.status === "connected",
  );
}

export async function connectCloudAccount(
  providerId: CloudProviderId,
  displayName: string,
  accessToken: string,
): Promise<ConnectedCloudAccount> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error("Access token is required.");
  }

  // Verify the token before saving it.
  await listCloudEntries(providerId, token);

  const created = await saveResourceAccount({
    providerId,
    displayName:
      displayName.trim() ||
      providerId.replace("-", " "),
    status: "connected",
    metadata: {
      connectionMode: "access-token",
    },
  });

  if (!created) {
    throw new Error("Unable to persist the cloud account.");
  }

  try {
    await setResourceAccountToken(
      providerId,
      created.id,
      token,
    );
  } catch (error) {
    await deleteResourceAccount(created.id).catch(() => undefined);
    throw error;
  }

  return created as ConnectedCloudAccount;
}

export async function disconnectCloudAccount(
  account: ConnectedCloudAccount,
): Promise<void> {
  await deleteResourceAccountToken(
    account.providerId,
    account.id,
  ).catch(() => undefined);
  await deleteResourceAccount(account.id);
}

async function accountToken(
  account: ConnectedCloudAccount,
): Promise<string> {
  const token = await getResourceAccountToken(
    account.providerId,
    account.id,
  );

  if (!token) {
    throw new Error(
      "The secure access token for this cloud account is missing. Reconnect the account.",
    );
  }

  return token;
}

export async function browseCloudAccount(
  account: ConnectedCloudAccount,
  folder?: string,
): Promise<CloudListResult> {
  return listCloudEntries(
    account.providerId,
    await accountToken(account),
    folder,
  );
}

export async function searchCloudAccount(
  account: ConnectedCloudAccount,
  query: string,
  folder?: string,
): Promise<CloudListResult> {
  return searchCloudEntries(
    account.providerId,
    await accountToken(account),
    query,
    folder,
  );
}

function fileExtension(
  name: string,
  mimeType?: string,
): string | undefined {
  return supportedResourceBookFormat(name, mimeType) ?? undefined;
}

function contentTitle(name: string): string {
  return stripSupportedBookExtension(name);
}

export async function prepareCloudAcquisition(
  account: ConnectedCloudAccount,
  entry: CloudEntry,
): Promise<ResourceBundle> {
  if (!cloudEntryIsBook(entry)) {
    throw new Error(
      "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 files from cloud storage.",
    );
  }

  const sourceKey =
    account.id + ":" + entry.id;
  const existing = await findResourceBundleBySource(
    account.providerId,
    sourceKey,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");

  const item: ResourceItem = {
    id: itemId,
    title: contentTitle(entry.name),
    authors: [],
    identifiers: {
      providerVersionId: entry.id,
    },
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      cloudProvider: account.providerId,
      cloudAccountId: account.id,
      modifiedAt: entry.modifiedAt,
    },
    rightsStatus: "user-owned",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: account.providerId,
    sourceKey,
    sourceType: "cloud",
    metadata: {
      accountId: account.id,
      fileId: entry.id,
      path: entry.path,
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
    relativePath: entry.path,
    sizeBytes: entry.size,
    mimeType: entry.mimeType,
    extension: fileExtension(entry.name, entry.mimeType),
    identifiers: {
      providerVersionId: entry.id,
    },
    metadata: {
      modifiedAt: entry.modifiedAt,
    },
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

export async function startCloudEntryAcquisition(
  account: ConnectedCloudAccount,
  entry: CloudEntry,
): Promise<TransferJob> {
  const token = await accountToken(account);
  const bundle = await prepareCloudAcquisition(
    account,
    entry,
  );
  const source = bundle.sources[0];
  const file = bundle.files[0];

  if (!source || !file) {
    throw new Error("Cloud resource persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: account.providerId,
    transportType: "cloud",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      cloudAccountId: account.id,
      resourceInput:
        account.providerId + ":" + entry.id,
      fileId: entry.id,
      filePath: entry.path,
      fileName: entry.name,
    },
  });

  if (!job) {
    throw new Error("Unable to create a cloud transfer job.");
  }

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: entry.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await startCloudDownload(
      job.id,
      account.providerId,
      token,
      entry.id,
      entry.name,
      entry.path,
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start cloud transfer.",
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

export async function resumeCloudTransfer(
  job: TransferJob,
): Promise<void> {
  if (!isCloudProvider(job.providerId)) {
    throw new Error("This is not a supported cloud transfer.");
  }

  const accountId =
    typeof job.resumeData?.cloudAccountId === "string"
      ? job.resumeData.cloudAccountId
      : "";
  const fileId =
    typeof job.resumeData?.fileId === "string"
      ? job.resumeData.fileId
      : "";
  const fileName =
    typeof job.resumeData?.fileName === "string"
      ? job.resumeData.fileName
      : "download";
  const filePath =
    typeof job.resumeData?.filePath === "string"
      ? job.resumeData.filePath
      : undefined;

  if (!accountId || !fileId) {
    throw new Error(
      "This cloud job is missing resumable account/file metadata.",
    );
  }

  const token = await getResourceAccountToken(
    job.providerId,
    accountId,
  );
  if (!token) {
    throw new Error(
      "The cloud account token is unavailable. Reconnect the account before resuming.",
    );
  }

  await resetTransferJobForRetry(job.id);

  try {
    await startCloudDownload(
      job.id,
      job.providerId,
      token,
      fileId,
      fileName,
      filePath,
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to resume cloud transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardCloudTransfer(
  job: TransferJob,
): Promise<void> {
  await cleanupCloudTransfer(job.id).catch((error) => {
    console.warn("Unable to clean cloud temp files", error);
  });

  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export {
  pauseCloudDownload,
  cancelCloudDownload,
};

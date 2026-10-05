import {
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";
import {
  cancelS3Download,
  cleanupS3Transfer,
  listS3Entries,
  pauseS3Download,
  searchS3Entries,
  startS3Download,
  s3EntryIsBook,
  type S3Connection,
  type S3Credentials,
  type S3Entry,
  type S3ListResult,
} from "./s3Transport";
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

export interface ConnectedS3Account extends ResourceAccount {
  providerId: "s3";
}

export interface S3AccountInput {
  displayName?: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix?: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
}

function parseCredentials(value: string | null): S3Credentials | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<S3Credentials>;
    if (
      typeof parsed.accessKey === "string" &&
      typeof parsed.secretKey === "string" &&
      parsed.accessKey &&
      parsed.secretKey
    ) {
      return {
        accessKey: parsed.accessKey,
        secretKey: parsed.secretKey,
        sessionToken:
          typeof parsed.sessionToken === "string" &&
          parsed.sessionToken
            ? parsed.sessionToken
            : undefined,
      };
    }
  } catch {
    // Old/invalid secret values are handled as disconnected credentials.
  }

  return null;
}

async function accountConnection(
  account: ConnectedS3Account,
): Promise<S3Connection> {
  const credentials = parseCredentials(
    await getResourceAccountToken("s3", account.id),
  );

  if (!credentials) {
    throw new Error(
      "S3 credentials are missing. Reconnect this storage account.",
    );
  }

  const endpoint =
    typeof account.metadata.endpoint === "string"
      ? account.metadata.endpoint
      : "";
  const region =
    typeof account.metadata.region === "string"
      ? account.metadata.region
      : "";
  const bucket =
    typeof account.metadata.bucket === "string"
      ? account.metadata.bucket
      : "";

  if (!endpoint || !region || !bucket) {
    throw new Error("S3 account metadata is incomplete.");
  }

  return {
    endpoint,
    region,
    bucket,
    ...credentials,
  };
}

function accountPrefix(account: ConnectedS3Account): string | undefined {
  const prefix =
    typeof account.metadata.prefix === "string"
      ? account.metadata.prefix
      : "";
  return prefix || undefined;
}

export async function listS3Accounts(): Promise<ConnectedS3Account[]> {
  return (await listResourceAccounts()).filter(
    (account): account is ConnectedS3Account =>
      account.providerId === "s3" &&
      account.status === "connected",
  );
}

export async function connectS3Account(
  input: S3AccountInput,
): Promise<ConnectedS3Account> {
  const connection: S3Connection = {
    endpoint: input.endpoint.trim(),
    region: input.region.trim(),
    bucket: input.bucket.trim(),
    accessKey: input.accessKey.trim(),
    secretKey: input.secretKey,
    sessionToken: input.sessionToken?.trim() || undefined,
  };

  if (
    !connection.endpoint ||
    !connection.region ||
    !connection.bucket ||
    !connection.accessKey ||
    !connection.secretKey
  ) {
    throw new Error(
      "S3 endpoint, region, bucket, access key, and secret key are required.",
    );
  }

  const prefix = input.prefix?.trim() || undefined;
  await listS3Entries(connection, prefix);

  const saved = await saveResourceAccount({
    providerId: "s3",
    displayName:
      input.displayName?.trim() ||
      connection.bucket,
    status: "connected",
    externalAccountId: connection.bucket,
    metadata: {
      endpoint: connection.endpoint,
      region: connection.region,
      bucket: connection.bucket,
      prefix: prefix ?? "",
    },
  });

  if (!saved) {
    throw new Error("Unable to persist the S3 account.");
  }

  try {
    await setResourceAccountToken(
      "s3",
      saved.id,
      JSON.stringify({
        accessKey: connection.accessKey,
        secretKey: connection.secretKey,
        sessionToken: connection.sessionToken,
      }),
    );
  } catch (error) {
    await deleteResourceAccount(saved.id).catch(() => undefined);
    throw error;
  }

  return saved as ConnectedS3Account;
}

export async function disconnectS3Account(
  account: ConnectedS3Account,
): Promise<void> {
  await deleteResourceAccountToken("s3", account.id).catch(
    () => undefined,
  );
  await deleteResourceAccount(account.id);
}

export async function browseS3Account(
  account: ConnectedS3Account,
  prefix?: string,
): Promise<S3ListResult> {
  return listS3Entries(
    await accountConnection(account),
    prefix ?? accountPrefix(account),
  );
}

export async function searchS3Account(
  account: ConnectedS3Account,
  query: string,
  prefix?: string,
): Promise<S3ListResult> {
  return searchS3Entries(
    await accountConnection(account),
    query,
    prefix ?? accountPrefix(account),
  );
}

function title(name: string): string {
  return stripSupportedBookExtension(name);
}

async function prepareS3Resource(
  account: ConnectedS3Account,
  entry: S3Entry,
): Promise<ResourceBundle> {
  if (!s3EntryIsBook(entry)) {
    throw new Error(
      "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 objects from S3.",
    );
  }

  const sourceKey = account.id + ":" + entry.key;
  const existing = await findResourceBundleBySource(
    "s3",
    sourceKey,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");
  const format = supportedResourceBookFormat(entry.name);

  const item: ResourceItem = {
    id: itemId,
    title: title(entry.name),
    authors: [],
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      s3AccountId: account.id,
      bucket: account.metadata.bucket,
      modifiedAt: entry.modifiedAt,
      etag: entry.etag,
    },
    rightsStatus: "user-owned",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "s3",
    sourceKey,
    sourceType: "cloud",
    uri:
      "s3://" +
      String(account.metadata.bucket ?? "") +
      "/" +
      entry.key,
    metadata: {
      accountId: account.id,
      key: entry.key,
      etag: entry.etag,
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
    relativePath: entry.key,
    sizeBytes: entry.size,
    extension: format ?? undefined,
    identifiers: {
      providerVersionId:
        entry.etag ??
        (entry.modifiedAt
          ? entry.key + "@" + entry.modifiedAt
          : entry.key),
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

export async function startS3EntryAcquisition(
  account: ConnectedS3Account,
  entry: S3Entry,
): Promise<TransferJob> {
  const connection = await accountConnection(account);
  const bundle = await prepareS3Resource(account, entry);
  const source = bundle.sources[0];
  const file = bundle.files[0];

  if (!source || !file) {
    throw new Error("S3 resource persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: "s3",
    transportType: "s3",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      s3AccountId: account.id,
      resourceInput:
        "s3://" +
        String(account.metadata.bucket ?? "") +
        "/" +
        entry.key,
      key: entry.key,
      fileName: entry.name,
    },
  });

  if (!job) throw new Error("Unable to create S3 transfer job.");

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: entry.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await startS3Download(job.id, connection, entry);
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start S3 transfer.",
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
): Promise<ConnectedS3Account> {
  const id =
    typeof job.resumeData?.s3AccountId === "string"
      ? job.resumeData.s3AccountId
      : "";
  const account = (await listS3Accounts()).find(
    (item) => item.id === id,
  );

  if (!account) {
    throw new Error(
      "The S3 account for this transfer is no longer configured.",
    );
  }

  return account;
}

export async function resumeS3Transfer(job: TransferJob): Promise<void> {
  const account = await accountForJob(job);
  const connection = await accountConnection(account);
  const key =
    typeof job.resumeData?.key === "string"
      ? job.resumeData.key
      : "";
  const fileName =
    typeof job.resumeData?.fileName === "string"
      ? job.resumeData.fileName
      : key.split("/").pop() || "download";

  if (!key) {
    throw new Error("The S3 transfer is missing its object key.");
  }

  await resetTransferJobForRetry(job.id);

  try {
    await startS3Download(job.id, connection, {
      id: key,
      name: fileName,
      key,
      isFolder: false,
    });
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to resume S3 transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardS3Transfer(job: TransferJob): Promise<void> {
  await cleanupS3Transfer(job.id).catch(() => undefined);
  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export {
  pauseS3Download,
  cancelS3Download,
};

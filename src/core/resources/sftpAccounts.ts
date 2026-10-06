import {
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";
import {
  cancelSftpDownload,
  cleanupSftpTransfer,
  listSftpEntries,
  pauseSftpDownload,
  searchSftpEntries,
  startSftpDownload,
  sftpEntryIsBook,
  type SftpConnection,
  type SftpEntry,
  type SftpListResult,
} from "./sftpTransport";
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

export interface ConnectedSftpAccount extends ResourceAccount {
  providerId: "sftp";
}

export interface SftpAccountInput {
  displayName?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  rootPath?: string;
}

interface SftpSecret {
  password?: string;
  privateKeyPassphrase?: string;
}

function parseSecret(value: string | null): SftpSecret {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as SftpSecret;
    return {
      password:
        typeof parsed.password === "string" && parsed.password
          ? parsed.password
          : undefined,
      privateKeyPassphrase:
        typeof parsed.privateKeyPassphrase === "string" &&
        parsed.privateKeyPassphrase
          ? parsed.privateKeyPassphrase
          : undefined,
    };
  } catch {
    return { password: value };
  }
}

function accountRootPath(
  account: ConnectedSftpAccount,
): string | undefined {
  const value =
    typeof account.metadata.rootPath === "string"
      ? account.metadata.rootPath.trim()
      : "";
  return value || undefined;
}

async function accountConnection(
  account: ConnectedSftpAccount,
): Promise<SftpConnection> {
  const secret = parseSecret(
    await getResourceAccountToken("sftp", account.id),
  );

  const host =
    typeof account.metadata.host === "string"
      ? account.metadata.host
      : "";
  const port =
    typeof account.metadata.port === "number"
      ? account.metadata.port
      : Number(account.metadata.port ?? 22);
  const username =
    typeof account.metadata.username === "string"
      ? account.metadata.username
      : "";
  const privateKeyPath =
    typeof account.metadata.privateKeyPath === "string" &&
    account.metadata.privateKeyPath
      ? account.metadata.privateKeyPath
      : undefined;

  if (!host || !username || !Number.isFinite(port)) {
    throw new Error("SFTP account metadata is incomplete.");
  }

  return {
    host,
    port,
    username,
    password: secret.password,
    privateKeyPath,
    privateKeyPassphrase: secret.privateKeyPassphrase,
  };
}

export async function listSftpAccounts(): Promise<
  ConnectedSftpAccount[]
> {
  return (await listResourceAccounts()).filter(
    (account): account is ConnectedSftpAccount =>
      account.providerId === "sftp" &&
      account.status === "connected",
  );
}

export async function connectSftpAccount(
  input: SftpAccountInput,
): Promise<ConnectedSftpAccount> {
  const host = input.host.trim();
  const port = Math.max(1, Math.min(65535, Math.trunc(input.port ?? 22)));
  const username = input.username.trim();
  const password = input.password || undefined;
  const privateKeyPath = input.privateKeyPath?.trim() || undefined;
  const privateKeyPassphrase =
    input.privateKeyPassphrase || undefined;
  const rootPath = input.rootPath?.trim() || "/";

  if (!host || !username) {
    throw new Error("SFTP host and username are required.");
  }

  if (!password && !privateKeyPath) {
    throw new Error(
      "Provide either an SFTP password or a private-key path.",
    );
  }

  const connection: SftpConnection = {
    host,
    port,
    username,
    password,
    privateKeyPath,
    privateKeyPassphrase,
  };

  await listSftpEntries(connection, rootPath);

  const saved = await saveResourceAccount({
    providerId: "sftp",
    displayName:
      input.displayName?.trim() || username + "@" + host,
    status: "connected",
    externalAccountId: username + "@" + host + ":" + port,
    metadata: {
      host,
      port,
      username,
      privateKeyPath: privateKeyPath ?? "",
      rootPath,
      authMode: privateKeyPath ? "private-key" : "password",
    },
  });

  if (!saved) {
    throw new Error("Unable to persist the SFTP account.");
  }

  try {
    await setResourceAccountToken(
      "sftp",
      saved.id,
      JSON.stringify({
        password,
        privateKeyPassphrase,
      }),
    );
  } catch (error) {
    await deleteResourceAccount(saved.id).catch(() => undefined);
    throw error;
  }

  return saved as ConnectedSftpAccount;
}

export async function disconnectSftpAccount(
  account: ConnectedSftpAccount,
): Promise<void> {
  await deleteResourceAccountToken("sftp", account.id).catch(
    () => undefined,
  );
  await deleteResourceAccount(account.id);
}

export async function browseSftpAccount(
  account: ConnectedSftpAccount,
  path?: string,
): Promise<SftpListResult> {
  return listSftpEntries(
    await accountConnection(account),
    path ?? accountRootPath(account),
  );
}

export async function searchSftpAccount(
  account: ConnectedSftpAccount,
  query: string,
  path?: string,
): Promise<SftpListResult> {
  return searchSftpEntries(
    await accountConnection(account),
    query,
    path ?? accountRootPath(account),
  );
}

async function prepareSftpResource(
  account: ConnectedSftpAccount,
  entry: SftpEntry,
): Promise<ResourceBundle> {
  if (!sftpEntryIsBook(entry)) {
    throw new Error(
      "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 files from SFTP.",
    );
  }

  const sourceKey = account.id + ":" + entry.path;
  const existing = await findResourceBundleBySource(
    "sftp",
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
    title: stripSupportedBookExtension(entry.name),
    authors: [],
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      sftpAccountId: account.id,
      modifiedAt: entry.modifiedAt,
    },
    rightsStatus: "user-owned",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "sftp",
    sourceKey,
    sourceType: "cloud",
    uri:
      "sftp://" +
      String(account.metadata.host ?? "") +
      ":" +
      String(account.metadata.port ?? 22) +
      entry.path,
    metadata: {
      accountId: account.id,
      remotePath: entry.path,
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
    relativePath: entry.path,
    sizeBytes: entry.size,
    extension: format ?? undefined,
    identifiers: {
      providerVersionId:
        entry.modifiedAt !== undefined
          ? entry.path + "@" + entry.modifiedAt
          : entry.path,
    },
    metadata: {},
    createdAt: now,
  };

  const bundle: ResourceBundle = {
    item,
    sources: [source],
    files: [file],
  };

  await saveResourceBundle(bundle);
  return bundle;
}

export async function startSftpEntryAcquisition(
  account: ConnectedSftpAccount,
  entry: SftpEntry,
): Promise<TransferJob> {
  const connection = await accountConnection(account);
  const bundle = await prepareSftpResource(account, entry);
  const source = bundle.sources[0];
  const file = bundle.files[0];

  if (!source || !file) {
    throw new Error("SFTP resource persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: "sftp",
    transportType: "sftp",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      sftpAccountId: account.id,
      resourceInput:
        "sftp://" +
        String(account.metadata.host ?? "") +
        ":" +
        String(account.metadata.port ?? 22) +
        entry.path,
      remotePath: entry.path,
      fileName: entry.name,
    },
  });

  if (!job) throw new Error("Unable to create SFTP transfer job.");

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: entry.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await startSftpDownload(job.id, connection, entry);
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start SFTP transfer.",
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
): Promise<ConnectedSftpAccount> {
  const id =
    typeof job.resumeData?.sftpAccountId === "string"
      ? job.resumeData.sftpAccountId
      : "";
  const account = (await listSftpAccounts()).find(
    (item) => item.id === id,
  );

  if (!account) {
    throw new Error(
      "The SFTP account for this transfer is no longer configured.",
    );
  }

  return account;
}

export async function resumeSftpTransfer(
  job: TransferJob,
): Promise<void> {
  const account = await accountForJob(job);
  const connection = await accountConnection(account);
  const remotePath =
    typeof job.resumeData?.remotePath === "string"
      ? job.resumeData.remotePath
      : "";
  const fileName =
    typeof job.resumeData?.fileName === "string"
      ? job.resumeData.fileName
      : remotePath.split("/").pop() || "download";

  if (!remotePath) {
    throw new Error("The SFTP transfer is missing its remote path.");
  }

  await resetTransferJobForRetry(job.id);

  try {
    await startSftpDownload(job.id, connection, {
      id: remotePath,
      name: fileName,
      path: remotePath,
      isFolder: false,
    });
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to resume SFTP transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardSftpTransfer(
  job: TransferJob,
): Promise<void> {
  await cleanupSftpTransfer(job.id).catch(() => undefined);
  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export {
  pauseSftpDownload,
  cancelSftpDownload,
};

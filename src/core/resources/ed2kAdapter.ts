import {
  addEd2kLink,
  attachEd2kJob,
  cancelEd2kJob,
  downloadEd2kSearchResult,
  getEd2kStatus,
  pauseEd2kJob,
  resumeEd2kJob,
  searchEd2k,
  type Ed2kConnectionConfig,
  type Ed2kLinkMetadata,
  type Ed2kSearchResponse,
  type Ed2kSearchResult,
} from "./ed2kTransport";
import {
  createDraftTransferJob,
  createResourceRecordId,
  deleteResourceAccount,
  findResourceBundleBySource,
  getTransferJob,
  listResourceAccounts,
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

export interface Ed2kEngineSettings {
  executable?: string;
  host?: string;
  port?: number;
  password?: string;
  incomingDir: string;
}

export interface Ed2kEngineAccount extends ResourceAccount {
  providerId: "ed2k";
}

export function parseEd2kLink(link: string): Ed2kLinkMetadata {
  const trimmed = link.trim();
  if (!/^ed2k:\/\/\|file\|/i.test(trimmed)) {
    throw new Error("Only ED2K file links are supported.");
  }

  const fields = trimmed.split("|");
  if (fields.length < 6 || fields[1].toLowerCase() !== "file") {
    throw new Error("Malformed ED2K file link.");
  }

  let name: string;
  try {
    name = decodeURIComponent(fields[2]);
  } catch {
    name = fields[2];
  }

  const size = Number(fields[3]);
  const hash = fields[4].trim().toLowerCase();

  if (!Number.isFinite(size) || size < 0) {
    throw new Error("ED2K file size is invalid.");
  }

  if (!/^[0-9a-f]{32}$/i.test(hash)) {
    throw new Error("ED2K hash is invalid.");
  }

  return {
    name,
    size,
    hash,
    bookCandidate: /\.(pdf|epub)$/i.test(name),
  };
}

function metadataSettings(
  account: Ed2kEngineAccount,
): Omit<Ed2kConnectionConfig, "password"> {
  const metadata = account.metadata ?? {};

  return {
    executable:
      typeof metadata.executable === "string"
        ? metadata.executable
        : undefined,
    host:
      typeof metadata.host === "string"
        ? metadata.host
        : "127.0.0.1",
    port:
      typeof metadata.port === "number"
        ? metadata.port
        : 4712,
    incomingDir:
      typeof metadata.incomingDir === "string"
        ? metadata.incomingDir
        : undefined,
  };
}

export async function listEd2kEngines(): Promise<Ed2kEngineAccount[]> {
  const accounts = await listResourceAccounts();

  return accounts.filter(
    (account): account is Ed2kEngineAccount =>
      account.providerId === "ed2k" &&
      account.status === "connected",
  );
}

export async function ed2kConfigForAccount(
  account: Ed2kEngineAccount,
): Promise<Ed2kConnectionConfig> {
  const password = await getResourceAccountToken(
    "ed2k",
    account.id,
  );

  return {
    ...metadataSettings(account),
    password: password ?? undefined,
  };
}

export async function connectEd2kEngine(
  settings: Ed2kEngineSettings,
): Promise<Ed2kEngineAccount> {
  if (!settings.incomingDir.trim()) {
    throw new Error(
      "aMule Incoming directory is required so completed books can be imported.",
    );
  }

  const config: Ed2kConnectionConfig = {
    executable: settings.executable?.trim() || undefined,
    host: settings.host?.trim() || "127.0.0.1",
    port: settings.port || 4712,
    password: settings.password,
    incomingDir: settings.incomingDir.trim(),
  };

  const status = await getEd2kStatus(config);
  if (!status.available) {
    throw new Error(status.output || "Unable to connect to aMule.");
  }

  const account = await saveResourceAccount({
    providerId: "ed2k",
    displayName: "aMule ED2K",
    status: "connected",
    metadata: {
      executable: config.executable,
      host: config.host,
      port: config.port,
      incomingDir: config.incomingDir,
      lastStatus: status.output.slice(0, 1200),
    },
  });

  if (!account) {
    throw new Error("Unable to save the aMule ED2K connection.");
  }

  if (settings.password) {
    await setResourceAccountToken(
      "ed2k",
      account.id,
      settings.password,
    );
  }

  return account as Ed2kEngineAccount;
}

export async function disconnectEd2kEngine(
  account: Ed2kEngineAccount,
): Promise<void> {
  await deleteResourceAccountToken(
    "ed2k",
    account.id,
  ).catch(() => undefined);
  await deleteResourceAccount(account.id);
}

export async function searchEd2kEngine(
  account: Ed2kEngineAccount,
  query: string,
  searchType: "global" | "kad" | "local" = "global",
): Promise<Ed2kSearchResponse> {
  return searchEd2k(
    await ed2kConfigForAccount(account),
    query,
    searchType,
  );
}

function makeBundle(
  account: Ed2kEngineAccount,
  input: {
    sourceKey: string;
    name: string;
    size?: number;
    hash?: string;
    sourceUri?: string;
    metadata?: Record<string, unknown>;
  },
): ResourceBundle {
  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");
  const extension = input.name.toLowerCase().endsWith(".pdf")
    ? "pdf"
    : input.name.toLowerCase().endsWith(".epub")
      ? "epub"
      : undefined;
  const title = input.name.replace(/\.(pdf|epub)$/i, "");

  const item: ResourceItem = {
    id: itemId,
    title,
    authors: [],
    identifiers: input.hash
      ? { ed2kHash: input.hash.toLowerCase() }
      : {},
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      ed2kEngineAccountId: account.id,
      ...input.metadata,
    },
    rightsStatus: "unknown",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "ed2k",
    sourceKey: input.sourceKey,
    sourceType: "p2p",
    uri: input.sourceUri,
    metadata: {
      accountId: account.id,
      hash: input.hash,
      ...input.metadata,
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
    name: input.name,
    sizeBytes: input.size,
    extension,
    identifiers: input.hash
      ? { ed2kHash: input.hash.toLowerCase() }
      : {},
    metadata: input.metadata ?? {},
    createdAt: now,
  };

  return {
    item,
    sources: [source],
    files: [file],
  };
}

export async function startEd2kLinkAcquisition(
  account: Ed2kEngineAccount,
  link: string,
): Promise<TransferJob> {
  const metadata = parseEd2kLink(link);
  if (!metadata.bookCandidate) {
    throw new Error("LexiPane currently imports PDF/EPUB files from ED2K.");
  }

  const sourceKey = metadata.hash.toLowerCase();
  let bundle = await findResourceBundleBySource(
    "ed2k",
    sourceKey,
  );

  if (!bundle) {
    bundle = makeBundle(account, {
      sourceKey,
      name: metadata.name,
      size: metadata.size,
      hash: metadata.hash,
      sourceUri: link,
      metadata: { mode: "link" },
    });
    await saveResourceBundle(bundle);
  }

  const source = bundle.sources[0];
  const file = bundle.files[0];
  if (!source || !file) {
    throw new Error("ED2K resource persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: "ed2k",
    transportType: "ed2k",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      ed2kAccountId: account.id,
      mode: "link",
      resourceInput: link,
      name: metadata.name,
      size: metadata.size,
      hash: metadata.hash,
    },
  });

  if (!job) throw new Error("Unable to create ED2K transfer job.");

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: metadata.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await addEd2kLink(
      job.id,
      await ed2kConfigForAccount(account),
      link,
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to add ED2K link to aMule.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

  return (await getTransferJob(job.id)) ?? {
    ...job,
    state: "queued",
    bytesTotal: metadata.size,
  };
}

export async function startEd2kSearchResultAcquisition(
  account: Ed2kEngineAccount,
  query: string,
  result: Ed2kSearchResult,
): Promise<TransferJob> {
  if (!result.bookCandidate) {
    throw new Error("LexiPane currently imports PDF/EPUB files from ED2K.");
  }

  const sourceKey = [
    account.id,
    "search",
    result.name.toLowerCase(),
    result.size ?? "unknown",
  ].join(":");

  let bundle = await findResourceBundleBySource(
    "ed2k",
    sourceKey,
  );

  if (!bundle) {
    bundle = makeBundle(account, {
      sourceKey,
      name: result.name,
      size: result.size,
      metadata: {
        mode: "search-result",
        query,
        searchResultIndex: result.index,
        sources: result.sources,
      },
    });
    await saveResourceBundle(bundle);
  }

  const source = bundle.sources[0];
  const file = bundle.files[0];
  if (!source || !file) {
    throw new Error("ED2K search result persistence is incomplete.");
  }

  const job = await createDraftTransferJob({
    providerId: "ed2k",
    transportType: "ed2k",
    resourceItemId: bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      ed2kAccountId: account.id,
      mode: "search-result",
      query,
      resultIndex: result.index,
      name: result.name,
      size: result.size,
    },
  });

  if (!job) throw new Error("Unable to create ED2K transfer job.");

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: result.size,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await downloadEd2kSearchResult(
      job.id,
      await ed2kConfigForAccount(account),
      result,
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start ED2K search result download.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

  return (await getTransferJob(job.id)) ?? {
    ...job,
    state: "queued",
    bytesTotal: result.size,
  };
}

async function accountForJob(
  job: TransferJob,
): Promise<Ed2kEngineAccount> {
  const accountId =
    typeof job.resumeData?.ed2kAccountId === "string"
      ? job.resumeData.ed2kAccountId
      : "";

  const account = (await listEd2kEngines()).find(
    (item) => item.id === accountId,
  );
  if (!account) {
    throw new Error(
      "The aMule connection for this ED2K job is no longer configured.",
    );
  }
  return account;
}

export async function reattachEd2kTransfer(
  job: TransferJob,
  paused = false,
): Promise<boolean> {
  const account = await accountForJob(job);
  const name =
    typeof job.resumeData?.name === "string"
      ? job.resumeData.name
      : "";
  const size =
    typeof job.resumeData?.size === "number"
      ? job.resumeData.size
      : undefined;
  const hash =
    typeof job.resumeData?.hash === "string"
      ? job.resumeData.hash
      : undefined;

  if (!name) return false;

  return attachEd2kJob(
    job.id,
    await ed2kConfigForAccount(account),
    { name, size, hash, paused },
  );
}

export async function pauseEd2kTransfer(
  job: TransferJob,
): Promise<void> {
  const attached = await reattachEd2kTransfer(job, false);
  if (!attached) {
    throw new Error("The ED2K job is no longer present in aMule.");
  }
  await pauseEd2kJob(job.id);
}

export async function resumeEd2kTransfer(
  job: TransferJob,
): Promise<void> {
  const attached = await reattachEd2kTransfer(job, true);
  if (!attached) {
    throw new Error(
      "The ED2K job is no longer present in aMule. Re-add the link or search result.",
    );
  }

  await resumeEd2kJob(job.id);
  await updateTransferJob(job.id, {
    state: "running",
    error: null,
    completedAt: null,
  });
}

export async function cancelEd2kTransfer(
  job: TransferJob,
): Promise<void> {
  const attached = await reattachEd2kTransfer(job, false);
  if (attached) {
    await cancelEd2kJob(job.id);
  }

  await updateTransferJob(job.id, {
    state: "canceled",
    error: null,
    completedAt: new Date().toISOString(),
  });
}

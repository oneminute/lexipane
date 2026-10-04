import { getBookExtension } from "../books/openBook";
import {
  cancelHttpDownload,
  pauseHttpDownload,
  probeHttpResource,
  startHttpDownload,
  type HttpProbeResult,
} from "./httpTransport";
import {
  createDraftTransferJob,
  createResourceRecordId,
  findResourceBundleBySource,
  getTransferJob,
  resetTransferJobForRetry,
  saveResourceBundle,
  updateTransferJob,
  type ResourceBundle,
} from "./persistence";
import type {
  ResourceFile,
  ResourceItem,
  ResourceSource,
  TransferJob,
} from "./types";

export interface HttpAcquisitionPreparation {
  probe: HttpProbeResult;
  bundle: ResourceBundle;
}

function resourceTitle(
  url: string,
  fileName?: string,
): string {
  if (fileName?.trim()) {
    const name = fileName.trim();
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name || parsed.hostname;
  } catch {
    return url;
  }
}

export async function prepareHttpAcquisition(
  url: string,
  metadata: Record<string, unknown> = {},
): Promise<HttpAcquisitionPreparation> {
  const probe = await probeHttpResource(url);
  const sourceKey = probe.finalUrl;
  const existing = await findResourceBundleBySource(
    "http",
    sourceKey,
  );

  if (existing) {
    return { probe, bundle: existing };
  }

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");
  const extension = getBookExtension(
    probe.fileName ?? probe.finalUrl,
  );

  const item: ResourceItem = {
    id: itemId,
    title: resourceTitle(probe.finalUrl, probe.fileName),
    authors: [],
    identifiers: {},
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    metadata: {
      ...metadata,
      finalUrl: probe.finalUrl,
      contentType: probe.contentType,
      contentLength: probe.contentLength,
    },
    rightsStatus: "unknown",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "http",
    sourceKey,
    sourceType: "http",
    uri: probe.finalUrl,
    metadata: {
      ...metadata,
      acceptRanges: probe.acceptRanges,
      contentType: probe.contentType,
    },
    availability: {
      sourceCount: 1,
      remoteAvailable: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  const file: ResourceFile = {
    id: fileId,
    resourceItemId: itemId,
    sourceId,
    name: probe.fileName ?? "download",
    sizeBytes: probe.contentLength,
    mimeType: probe.contentType,
    extension: extension || undefined,
    identifiers: {},
    metadata: {},
    createdAt: now,
  };

  const bundle: ResourceBundle = {
    item,
    sources: [source],
    files: [file],
  };

  await saveResourceBundle(bundle);
  return { probe, bundle };
}

export async function startPreparedHttpAcquisition(
  preparation: HttpAcquisitionPreparation,
  requestedUrl?: string,
): Promise<TransferJob> {
  const source = preparation.bundle.sources[0];
  const file = preparation.bundle.files[0];

  if (!source || !file) {
    throw new Error("The HTTP resource has no acquisition source.");
  }

  const resourceInput =
    requestedUrl?.trim() ||
    source.uri ||
    preparation.probe.finalUrl;

  const job = await createDraftTransferJob({
    providerId: "http",
    transportType: "http",
    resourceItemId: preparation.bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      resourceInput,
      finalUrl: preparation.probe.finalUrl,
      fileNameHint: preparation.probe.fileName,
      contentType: preparation.probe.contentType,
      acceptRanges: preparation.probe.acceptRanges,
    },
  });

  if (!job) {
    throw new Error("Unable to create a persistent HTTP transfer job.");
  }

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: preparation.probe.contentLength,
    bytesCompleted: 0,
    error: null,
  });

  await startHttpDownload(
    job.id,
    preparation.probe.finalUrl,
    preparation.probe.fileName,
  );

  return (await getTransferJob(job.id)) ?? {
    ...job,
    state: "queued",
    bytesTotal: preparation.probe.contentLength,
  };
}

export async function startHttpAcquisition(
  url: string,
  metadata: Record<string, unknown> = {},
): Promise<{
  preparation: HttpAcquisitionPreparation;
  job: TransferJob;
}> {
  const preparation = await prepareHttpAcquisition(url, metadata);
  const job = await startPreparedHttpAcquisition(
    preparation,
    url,
  );

  return { preparation, job };
}

export async function resumeHttpTransfer(
  job: TransferJob,
): Promise<void> {
  const resourceInput =
    job.resumeData?.finalUrl ??
    job.resumeData?.resourceInput;
  const url =
    typeof resourceInput === "string" ? resourceInput : "";

  if (!url) {
    throw new Error("This transfer job does not contain a resumable URL.");
  }

  const fileNameHint =
    typeof job.resumeData?.fileNameHint === "string"
      ? job.resumeData.fileNameHint
      : undefined;

  await resetTransferJobForRetry(job.id);
  await startHttpDownload(job.id, url, fileNameHint);
}

export { pauseHttpDownload, cancelHttpDownload };

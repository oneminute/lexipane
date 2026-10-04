import { getBookExtension } from "../books/openBook";
import {
  cancelHttpDownload,
  cleanupHttpTransferTemp,
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
  const opdsCatalogUrl =
    typeof metadata.opdsCatalogUrl === "string"
      ? metadata.opdsCatalogUrl
      : undefined;
  const opdsEntryId =
    typeof metadata.opdsEntryId === "string"
      ? metadata.opdsEntryId
      : undefined;
  const opdsSourceKey = opdsCatalogUrl
    ? opdsCatalogUrl +
      "#" +
      (opdsEntryId ?? probe.finalUrl)
    : undefined;

  const sourceKey = probe.finalUrl;
  const existing = await findResourceBundleBySource(
    "http",
    sourceKey,
  );

  if (existing) {
    if (
      opdsCatalogUrl &&
      opdsSourceKey &&
      !existing.sources.some(
        (source) =>
          source.providerId === "opds" &&
          source.sourceKey === opdsSourceKey,
      )
    ) {
      const now = new Date().toISOString();
      const enriched: ResourceBundle = {
        ...existing,
        item: {
          ...existing.item,
          availability: {
            ...existing.item.availability,
            sourceCount: existing.sources.length + 1,
          },
          updatedAt: now,
        },
        sources: [
          ...existing.sources,
          {
            id: createResourceRecordId("source"),
            resourceItemId: existing.item.id,
            providerId: "opds",
            sourceKey: opdsSourceKey,
            sourceType: "catalog",
            uri: opdsCatalogUrl,
            metadata: {
              entryId: opdsEntryId,
              acquisitionUrl: probe.finalUrl,
            },
            availability: {
              remoteAvailable: true,
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      await saveResourceBundle(enriched);
      return { probe, bundle: enriched };
    }

    return { probe, bundle: existing };
  }

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");
  const extension = getBookExtension(
    probe.fileName ?? probe.finalUrl,
  );
  const normalizedType = probe.contentType?.toLowerCase() ?? "";
  const declaredType =
    typeof metadata.acquisitionType === "string"
      ? metadata.acquisitionType.toLowerCase()
      : "";
  const supportedByMetadata =
    extension === "pdf" ||
    extension === "epub" ||
    normalizedType.includes("application/pdf") ||
    normalizedType.includes("application/epub+zip") ||
    declaredType.includes("application/pdf") ||
    declaredType.includes("application/epub+zip");

  if (!supportedByMetadata) {
    throw new Error(
      "RESOURCE-002 direct HTTP acquisition currently accepts PDF and EPUB resources only.",
    );
  }

  const metadataTitle =
    typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : undefined;
  const metadataAuthors = Array.isArray(metadata.authors)
    ? metadata.authors.filter(
        (author): author is string =>
          typeof author === "string" && Boolean(author.trim()),
      )
    : [];
  const item: ResourceItem = {
    id: itemId,
    title:
      metadataTitle ??
      resourceTitle(probe.finalUrl, probe.fileName),
    authors: metadataAuthors,
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

  const sources: ResourceSource[] = [source];

  if (opdsCatalogUrl) {
    sources.push({
      id: createResourceRecordId("source"),
      resourceItemId: itemId,
      providerId: "opds",
      sourceKey:
        opdsSourceKey ??
        opdsCatalogUrl + "#" + probe.finalUrl,
      sourceType: "catalog",
      uri: opdsCatalogUrl,
      metadata: {
        entryId: opdsEntryId,
        acquisitionUrl: probe.finalUrl,
      },
      availability: {
        remoteAvailable: true,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  const bundle: ResourceBundle = {
    item: {
      ...item,
      availability: {
        ...item.availability,
        sourceCount: sources.length,
      },
    },
    sources,
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

  try {
    await startHttpDownload(
      job.id,
      preparation.probe.finalUrl,
      preparation.probe.fileName,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start HTTP transfer.";

    await updateTransferJob(job.id, {
      state: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

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

  try {
    await startHttpDownload(job.id, url, fileNameHint);
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to restart HTTP transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardHttpTransfer(
  job: TransferJob,
): Promise<void> {
  await cleanupHttpTransferTemp(job.id).catch((error) => {
    console.warn("Unable to clean transfer temp files", error);
  });

  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export { pauseHttpDownload, cancelHttpDownload };

import {
  supportedResourceBookFormat,
} from "./bookFormats";
import {
  cancelTorrentDownload,
  cleanupTorrentTransfer,
  pauseTorrentDownload,
  previewTorrent,
  startTorrentDownload,
  type TorrentPreviewFile,
  type TorrentPreviewResult,
} from "./torrentTransport";
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

export interface TorrentAcquisitionPreparation {
  input: string;
  preview: TorrentPreviewResult;
  selectedFile: TorrentPreviewFile;
  bundle: ResourceBundle;
}

function titleFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() || path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function extensionFromName(name: string): string | undefined {
  return supportedResourceBookFormat(name) ?? undefined;
}

export async function inspectTorrent(
  input: string,
): Promise<TorrentPreviewResult> {
  return previewTorrent(input);
}

export async function prepareTorrentAcquisition(
  input: string,
  preview: TorrentPreviewResult,
  selectedFile: TorrentPreviewFile,
): Promise<TorrentAcquisitionPreparation> {
  if (!selectedFile.bookCandidate) {
    throw new Error(
      "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 files from torrents.",
    );
  }

  const sourceKey =
    preview.infoHash.toLowerCase() + ":" + selectedFile.index;
  const existing = await findResourceBundleBySource(
    "bittorrent",
    sourceKey,
  );

  if (existing) {
    return {
      input,
      preview,
      selectedFile,
      bundle: existing,
    };
  }

  const now = new Date().toISOString();
  const itemId = createResourceRecordId("resource");
  const sourceId = createResourceRecordId("source");
  const fileId = createResourceRecordId("file");
  const extension = extensionFromName(selectedFile.name);

  const item: ResourceItem = {
    id: itemId,
    title: titleFromPath(selectedFile.name),
    authors: [],
    identifiers: {
      btih: preview.infoHash.toLowerCase(),
    },
    availability: {
      sourceCount: 1,
      peers: preview.seenPeers,
      remoteAvailable: true,
    },
    metadata: {
      torrentName: preview.name,
      torrentFileIndex: selectedFile.index,
    },
    rightsStatus: "unknown",
    createdAt: now,
    updatedAt: now,
  };

  const source: ResourceSource = {
    id: sourceId,
    resourceItemId: itemId,
    providerId: "bittorrent",
    sourceKey,
    sourceType: "p2p",
    uri: input,
    metadata: {
      infoHash: preview.infoHash,
      torrentName: preview.name,
      fileIndex: selectedFile.index,
    },
    availability: {
      peers: preview.seenPeers,
      remoteAvailable: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  const file: ResourceFile = {
    id: fileId,
    resourceItemId: itemId,
    sourceId,
    name: selectedFile.name,
    relativePath: selectedFile.name,
    sizeBytes: selectedFile.length,
    extension,
    identifiers: {
      btih: preview.infoHash.toLowerCase(),
    },
    metadata: {
      torrentFileIndex: selectedFile.index,
    },
    createdAt: now,
  };

  const bundle: ResourceBundle = {
    item,
    sources: [source],
    files: [file],
  };

  await saveResourceBundle(bundle);

  return {
    input,
    preview,
    selectedFile,
    bundle,
  };
}

export async function startPreparedTorrentAcquisition(
  preparation: TorrentAcquisitionPreparation,
): Promise<TransferJob> {
  const source = preparation.bundle.sources[0];
  const file = preparation.bundle.files[0];

  if (!source || !file) {
    throw new Error("The torrent resource is missing its source/file record.");
  }

  const job = await createDraftTransferJob({
    providerId: "bittorrent",
    transportType: "bittorrent",
    resourceItemId: preparation.bundle.item.id,
    sourceId: source.id,
    fileId: file.id,
    resumeData: {
      resourceInput: preparation.input,
      infoHash: preparation.preview.infoHash,
      fileIndex: preparation.selectedFile.index,
      fileName: preparation.selectedFile.name,
    },
  });

  if (!job) {
    throw new Error("Unable to create a persistent BitTorrent transfer job.");
  }

  await updateTransferJob(job.id, {
    state: "queued",
    progress: 0,
    bytesTotal: preparation.selectedFile.length,
    bytesCompleted: 0,
    error: null,
  });

  try {
    await startTorrentDownload(
      job.id,
      preparation.input,
      preparation.selectedFile.index,
    );
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to start BitTorrent transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }

  return (await getTransferJob(job.id)) ?? {
    ...job,
    state: "queued",
    bytesTotal: preparation.selectedFile.length,
  };
}

export async function resumeTorrentTransfer(
  job: TransferJob,
): Promise<void> {
  const input =
    typeof job.resumeData?.resourceInput === "string"
      ? job.resumeData.resourceInput
      : "";
  const fileIndex =
    typeof job.resumeData?.fileIndex === "number"
      ? job.resumeData.fileIndex
      : Number(job.resumeData?.fileIndex);

  if (!input || !Number.isInteger(fileIndex) || fileIndex < 0) {
    throw new Error(
      "This BitTorrent job is missing resumable source metadata.",
    );
  }

  await resetTransferJobForRetry(job.id);

  try {
    await startTorrentDownload(job.id, input, fileIndex);
  } catch (error) {
    await updateTransferJob(job.id, {
      state: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Unable to resume BitTorrent transfer.",
      completedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function discardTorrentTransfer(
  job: TransferJob,
): Promise<void> {
  await cleanupTorrentTransfer(job.id).catch((error) => {
    console.warn("Unable to clean torrent temp files", error);
  });

  await updateTransferJob(job.id, {
    state: "canceled",
    downloadRate: 0,
    uploadRate: 0,
    temporaryPath: null,
    error: null,
    completedAt: new Date().toISOString(),
  });
}

export { pauseTorrentDownload, cancelTorrentDownload };

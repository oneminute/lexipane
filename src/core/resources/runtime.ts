import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  copyLibraryBookToManagedStorage,
  findLibraryBookByHash,
  registerBookFile,
  restoreMissingLibraryBookToManagedStorage,
} from "../books/library";
import {
  checkBookFiles,
  computeBookFileHash,
} from "../books/fileIdentity";
import { isSupportedBookPath } from "../books/openBook";
import {
  cleanupHttpTransferTemp,
  listenForResourceTransferEvents,
  type ResourceTransferEvent,
} from "./httpTransport";
import {
  appendResourceHistory,
  getTransferJob,
  listTransferJobs,
  recordResourceContentHash,
  updateTransferJob,
} from "./persistence";

export const RESOURCE_TRANSFER_UPDATED_EVENT =
  "lexipane:resource-transfer-updated";

interface RuntimeOptions {
  onLibraryChanged?: () => void;
}

function dispatchTransferUpdated(jobId: string) {
  globalThis.dispatchEvent(
    new CustomEvent(RESOURCE_TRANSFER_UPDATED_EVENT, {
      detail: { jobId },
    }),
  );
}

async function ingestDownloadedTransfer(
  event: ResourceTransferEvent,
  options: RuntimeOptions,
): Promise<void> {
  const job = await getTransferJob(event.jobId);
  if (!job || !event.tempPath) return;

  if (!event.detectedFormat || !["pdf", "epub"].includes(event.detectedFormat)) {
    throw new Error(
      "The downloaded resource is not a validated PDF or EPUB.",
    );
  }

  if (!isSupportedBookPath(event.tempPath)) {
    throw new Error(
      "The validated download does not have a Reader-supported file path.",
    );
  }

  await updateTransferJob(event.jobId, {
    state: "ingesting",
    progress: 1,
    bytesTotal: event.bytesTotal,
    bytesCompleted: event.bytesCompleted,
    temporaryPath: event.tempPath,
    downloadRate: event.downloadRate,
    error: null,
  });
  dispatchTransferUpdated(event.jobId);

  const fileHash = await computeBookFileHash(event.tempPath);
  if (!fileHash) {
    throw new Error("Unable to compute a SHA-256 identity for the download.");
  }

  const existing = await findLibraryBookByHash(fileHash);
  let destinationPath: string;
  let bookId: string;
  let duplicate = false;
  let repairedMissingCopy = false;

  if (existing) {
    const status = await checkBookFiles([existing.file_path]);
    const existingFilePresent = status[0]?.exists === true;

    if (existingFilePresent) {
      destinationPath = existing.file_path;
      bookId = existing.id;
      duplicate = true;
    } else {
      const managed =
        await restoreMissingLibraryBookToManagedStorage(
          existing.id,
          event.tempPath,
        );

      destinationPath = managed.file_path;
      bookId = managed.id;
      duplicate = true;
      repairedMissingCopy = true;
    }
  } else {
    const registered = await registerBookFile(event.tempPath);
    if (!registered) {
      throw new Error("Unable to register the downloaded book.");
    }

    const managed =
      registered.managed_copy === 1
        ? registered
        : await copyLibraryBookToManagedStorage(registered.id);

    destinationPath = managed.file_path;
    bookId = managed.id;
  }

  const freshJob = (await getTransferJob(event.jobId)) ?? job;

  await recordResourceContentHash(
    freshJob.resourceItemId,
    freshJob.fileId,
    fileHash,
  );

  await appendResourceHistory(
    freshJob.resourceItemId,
    freshJob.providerId,
    repairedMissingCopy
      ? "duplicate-restored"
      : duplicate
        ? "duplicate-detected"
        : "ingested",
    {
      transferJobId: event.jobId,
      bookId,
      sha256: fileHash,
      destinationPath,
      duplicate,
      repairedMissingCopy,
    },
  );

  await updateTransferJob(event.jobId, {
    state: "completed",
    progress: 1,
    bytesTotal: event.bytesTotal,
    bytesCompleted: event.bytesCompleted,
    downloadRate: 0,
    temporaryPath: null,
    destinationPath,
    error: null,
    completedAt: new Date().toISOString(),
    resumeData: {
      ...(freshJob.resumeData ?? {}),
      contentHash: fileHash,
      detectedFormat: event.detectedFormat,
      ingestedBookId: bookId,
      duplicate,
      repairedMissingCopy,
    },
  });

  await cleanupHttpTransferTemp(event.jobId).catch((error) => {
    console.warn("Unable to clean Resource Hub temp files", error);
  });

  options.onLibraryChanged?.();
  dispatchTransferUpdated(event.jobId);
}

async function persistNativeTransferEvent(
  event: ResourceTransferEvent,
  options: RuntimeOptions,
): Promise<void> {
  try {
    if (event.state === "downloaded") {
      const current = await getTransferJob(event.jobId);

      await updateTransferJob(event.jobId, {
        state: "downloaded",
        progress: 1,
        bytesTotal: event.bytesTotal,
        bytesCompleted: event.bytesCompleted,
        downloadRate: event.downloadRate,
        temporaryPath: event.tempPath,
        error: null,
        resumeData: {
          ...(current?.resumeData ?? {}),
          detectedFormat: event.detectedFormat,
          finalUrl: event.finalUrl,
          contentType: event.contentType,
          fileName: event.fileName,
        },
      });
      dispatchTransferUpdated(event.jobId);

      await ingestDownloadedTransfer(event, options);
      return;
    }

    await updateTransferJob(event.jobId, {
      state: event.state,
      progress: event.progress,
      bytesTotal: event.bytesTotal,
      bytesCompleted: event.bytesCompleted,
      downloadRate: event.downloadRate,
      temporaryPath: event.tempPath,
      error: event.error ?? null,
      completedAt:
        event.state === "failed" || event.state === "canceled"
          ? new Date().toISOString()
          : undefined,
    });

    dispatchTransferUpdated(event.jobId);
  } catch (error) {
    console.error("Unable to persist resource transfer event", error);

    if (event.state === "downloaded") {
      await updateTransferJob(event.jobId, {
        state: "failed",
        progress: event.progress,
        bytesTotal: event.bytesTotal,
        bytesCompleted: event.bytesCompleted,
        temporaryPath: event.tempPath,
        error:
          error instanceof Error
            ? "Ingestion failed: " + error.message
            : "Ingestion failed.",
        completedAt: new Date().toISOString(),
      }).catch((persistError) => {
        console.error(
          "Unable to persist resource ingestion failure",
          persistError,
        );
      });
      dispatchTransferUpdated(event.jobId);
    }
  }
}

async function recoverInterruptedTransfers(
  options: RuntimeOptions,
): Promise<void> {
  const jobs = await listTransferJobs();

  for (const job of jobs) {
    if (
      (job.state === "downloaded" || job.state === "ingesting") &&
      job.temporaryPath
    ) {
      await ingestDownloadedTransfer(
        {
          jobId: job.id,
          state: "downloaded",
          bytesTotal: job.bytesTotal,
          bytesCompleted: job.bytesCompleted,
          progress: 1,
          tempPath: job.temporaryPath,
          detectedFormat:
            typeof job.resumeData?.detectedFormat === "string"
              ? job.resumeData.detectedFormat
              : undefined,
        },
        options,
      ).catch(async (error) => {
        await updateTransferJob(job.id, {
          state: "failed",
          error:
            error instanceof Error
              ? "Recovery failed: " + error.message
              : "Recovery failed.",
        });
        dispatchTransferUpdated(job.id);
      });
      continue;
    }

    if (
      job.providerId === "http" &&
      (job.state === "running" || job.state === "queued")
    ) {
      await updateTransferJob(job.id, {
        state: "paused",
        downloadRate: 0,
        error:
          job.state === "queued"
            ? "LexiPane restarted before this HTTP transfer began. Resume to start it."
            : "LexiPane restarted while this HTTP transfer was running. Resume to continue from the partial file.",
      });
      dispatchTransferUpdated(job.id);
    }
  }
}

export async function initializeResourceTransferRuntime(
  options: RuntimeOptions = {},
): Promise<UnlistenFn> {
  await recoverInterruptedTransfers(options).catch((error) => {
    console.error("Unable to recover resource transfer jobs", error);
  });

  return listenForResourceTransferEvents((event) => {
    void persistNativeTransferEvent(event, options);
  });
}

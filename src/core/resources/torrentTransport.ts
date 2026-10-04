import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TorrentPreviewFile {
  index: number;
  name: string;
  length: number;
  included: boolean;
  bookCandidate: boolean;
}

export interface TorrentPreviewResult {
  infoHash: string;
  name?: string;
  files: TorrentPreviewFile[];
  seenPeers: number;
}

export interface TorrentStartResult {
  jobId: string;
  torrentId: number;
  started: boolean;
}

export async function previewTorrent(
  input: string,
): Promise<TorrentPreviewResult> {
  if (!isTauri()) {
    throw new Error("BitTorrent preview requires the desktop application.");
  }

  return invoke<TorrentPreviewResult>("resource_torrent_preview", {
    input,
  });
}

export async function startTorrentDownload(
  jobId: string,
  input: string,
  fileIndex: number,
): Promise<TorrentStartResult> {
  if (!isTauri()) {
    throw new Error("BitTorrent downloads require the desktop application.");
  }

  return invoke<TorrentStartResult>(
    "resource_torrent_start_download",
    {
      jobId,
      input,
      fileIndex,
    },
  );
}

export async function pauseTorrentDownload(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_torrent_pause", { jobId });
}

export async function cancelTorrentDownload(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_torrent_cancel", { jobId });
}

export async function cleanupTorrentTransfer(
  jobId: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("resource_torrent_cleanup", { jobId });
}

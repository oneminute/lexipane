import {
  prepareHttpAcquisition,
  type HttpAcquisitionPreparation,
} from "./acquisition";
import type { ResourceInputKind } from "./types";

export type SupportedShareProvider =
  | "google-drive"
  | "dropbox"
  | "onedrive";

function googleDriveFileId(url: URL): string | null {
  const match = url.pathname.match(/\/file\/d\/([^/]+)/i);
  if (match?.[1]) return match[1];

  return url.searchParams.get("id");
}

export function cloudShareDownloadUrl(
  provider: SupportedShareProvider,
  shareUrl: string,
): string {
  const url = new URL(shareUrl);

  if (provider === "google-drive") {
    const id = googleDriveFileId(url);
    if (!id) {
      throw new Error(
        "This Google Drive URL does not contain a recognizable file id.",
      );
    }

    const direct = new URL(
      "https://drive.usercontent.google.com/download",
    );
    direct.searchParams.set("id", id);
    direct.searchParams.set("export", "download");
    direct.searchParams.set("confirm", "t");
    return direct.toString();
  }

  if (provider === "dropbox") {
    url.searchParams.delete("raw");
    url.searchParams.set("dl", "1");
    return url.toString();
  }

  url.searchParams.set("download", "1");
  return url.toString();
}

export function isSupportedCloudShareKind(
  kind: ResourceInputKind,
): kind is SupportedShareProvider {
  return (
    kind === "google-drive" ||
    kind === "dropbox" ||
    kind === "onedrive"
  );
}

export async function prepareCloudShareAcquisition(
  provider: SupportedShareProvider,
  shareUrl: string,
): Promise<HttpAcquisitionPreparation> {
  const directUrl = cloudShareDownloadUrl(
    provider,
    shareUrl,
  );

  return prepareHttpAcquisition(directUrl, {
    shareProvider: provider,
    shareUrl,
    directShareDownloadUrl: directUrl,
  });
}

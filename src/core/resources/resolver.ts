import type {
  ResourceInputClassification,
  ResourceInputKind,
} from "./types";

function result(
  kind: ResourceInputKind,
  normalizedInput: string,
  reason: string,
  confidence: ResourceInputClassification["confidence"] = "high",
  providerHint?: string,
): ResourceInputClassification {
  return {
    kind,
    normalizedInput,
    reason,
    confidence,
    providerHint,
    startsNetworkActivity: false,
  };
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function looksLikeOpds(url: URL): boolean {
  const value = (url.pathname + url.search).toLowerCase();
  return (
    value.includes("/opds") ||
    value.includes("opds=") ||
    value.includes("format=opds") ||
    value.endsWith(".atom")
  );
}

function classifyWebUrl(
  url: URL,
  normalizedInput: string,
): ResourceInputClassification {
  const host = normalizedHost(url);
  const path = url.pathname.toLowerCase();

  if (
    host === "drive.google.com" ||
    host === "docs.google.com"
  ) {
    return result(
      "google-drive",
      normalizedInput,
      "Recognized a Google Drive or Google Docs share URL.",
      "high",
      "google-drive",
    );
  }

  if (
    host === "dropbox.com" ||
    host.endsWith(".dropbox.com") ||
    host === "dropboxusercontent.com" ||
    host.endsWith(".dropboxusercontent.com")
  ) {
    return result(
      "dropbox",
      normalizedInput,
      "Recognized a Dropbox URL.",
      "high",
      "dropbox",
    );
  }

  if (
    host === "1drv.ms" ||
    host === "onedrive.live.com" ||
    host.endsWith(".sharepoint.com")
  ) {
    return result(
      "onedrive",
      normalizedInput,
      "Recognized a OneDrive or SharePoint URL.",
      "high",
      "onedrive",
    );
  }

  if (looksLikeOpds(url)) {
    return result(
      "opds",
      normalizedInput,
      "The URL contains an OPDS/Atom catalog hint.",
      "medium",
      "opds",
    );
  }

  if (path.endsWith(".torrent")) {
    return result(
      "torrent",
      normalizedInput,
      "The URL points to a .torrent metadata file.",
      "high",
      "bittorrent",
    );
  }

  return result(
    "http",
    normalizedInput,
    "Recognized a standard HTTP/HTTPS resource.",
    "high",
    "http",
  );
}

export function classifyResourceInput(
  rawInput: string,
): ResourceInputClassification {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return result(
      "unknown",
      "",
      "Enter a URL, magnet link, ED2K link, share link, or catalog address.",
      "low",
    );
  }

  if (/^magnet:\?/i.test(trimmed)) {
    return result(
      "magnet",
      trimmed,
      "Recognized a BitTorrent magnet URI.",
      "high",
      "bittorrent",
    );
  }

  if (/^ed2k:\/\//i.test(trimmed)) {
    return result(
      "ed2k",
      trimmed,
      "Recognized an ED2K URI.",
      "high",
      "ed2k",
    );
  }

  if (/^webdav(s)?:\/\//i.test(trimmed)) {
    return result(
      "webdav",
      trimmed,
      "Recognized an explicit WebDAV URI.",
      "high",
    );
  }

  if (/^s3:\/\//i.test(trimmed)) {
    return result(
      "s3",
      trimmed,
      "Recognized an S3 URI.",
      "high",
    );
  }

  if (/^sftp:\/\//i.test(trimmed)) {
    return result(
      "sftp",
      trimmed,
      "Recognized an SFTP URI.",
      "high",
    );
  }

  if (/\.torrent(?:\?.*)?$/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return result(
      "torrent",
      trimmed,
      "Recognized a torrent metadata filename/path.",
      "medium",
      "bittorrent",
    );
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return classifyWebUrl(url, url.toString());
    }
  } catch {
    // Fall through to an intentionally non-networking unknown classification.
  }

  return result(
    "unknown",
    trimmed,
    "No supported resource scheme or share-link pattern was recognized.",
    "low",
  );
}

import { fetchHttpText } from "./httpTransport";
import {
  isSupportedResourceBook,
  supportedResourceBookFormat,
} from "./bookFormats";

export interface InternetArchiveResult {
  identifier: string;
  title: string;
  authors: string[];
  description?: string;
  language?: string[];
  downloads?: number;
}

export interface InternetArchiveAcquisition {
  name: string;
  url: string;
  size?: number;
  format: string;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function archiveQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      const safe = term.replace(/["\\]/g, "");
      return "(title:\"" + safe + "\" OR creator:\"" + safe + "\")";
    });

  return "mediatype:texts AND (" + terms.join(" AND ") + ")";
}

export async function searchInternetArchive(
  query: string,
  rows = 30,
): Promise<InternetArchiveResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const params = new URLSearchParams();
  params.set("q", archiveQuery(normalized));
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "creator");
  params.append("fl[]", "description");
  params.append("fl[]", "language");
  params.append("fl[]", "downloads");
  params.set("rows", String(Math.max(1, Math.min(50, rows))));
  params.set("page", "1");
  params.set("output", "json");

  const response = await fetchHttpText(
    "https://archive.org/advancedsearch.php?" + params.toString(),
  );
  const root = JSON.parse(response.body) as Record<string, unknown>;
  const responseObject =
    root.response && typeof root.response === "object"
      ? (root.response as Record<string, unknown>)
      : {};
  const docs = Array.isArray(responseObject.docs)
    ? responseObject.docs
    : [];

  return docs.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const identifier = text(record.identifier);
    if (!identifier) return [];

    return [{
      identifier,
      title: text(record.title) ?? identifier,
      authors: stringArray(record.creator),
      description: text(record.description),
      language: stringArray(record.language),
      downloads: numberValue(record.downloads),
    }];
  });
}

function encodedArchivePath(identifier: string, fileName: string): string {
  const encodedIdentifier = encodeURIComponent(identifier);
  const encodedFile = fileName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return (
    "https://archive.org/download/" +
    encodedIdentifier +
    "/" +
    encodedFile
  );
}

function formatPriority(format: string): number {
  switch (format) {
    case "epub":
      return 0;
    case "pdf":
      return 1;
    case "azw3":
      return 2;
    case "mobi":
      return 3;
    case "azw":
      return 4;
    default:
      return 10;
  }
}

export async function resolveInternetArchiveAcquisitions(
  result: InternetArchiveResult,
): Promise<InternetArchiveAcquisition[]> {
  const response = await fetchHttpText(
    "https://archive.org/metadata/" +
      encodeURIComponent(result.identifier),
  );
  const root = JSON.parse(response.body) as Record<string, unknown>;
  const files = Array.isArray(root.files) ? root.files : [];

  const candidates = files.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = text(record.name);
    if (!name) return [];

    const format = supportedResourceBookFormat(name);
    if (!format || !isSupportedResourceBook(name)) return [];

    return [{
      name,
      url: encodedArchivePath(result.identifier, name),
      size: numberValue(record.size),
      format,
    }];
  });

  candidates.sort((left, right) => {
    const formatOrder =
      formatPriority(left.format) - formatPriority(right.format);
    if (formatOrder !== 0) return formatOrder;

    return (left.size ?? Number.MAX_SAFE_INTEGER) -
      (right.size ?? Number.MAX_SAFE_INTEGER);
  });

  return candidates;
}

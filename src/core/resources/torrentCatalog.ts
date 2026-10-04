import { fetchHttpText } from "./httpTransport";
import {
  removeResourceCatalog,
  saveResourceCatalog,
  type ResourceCatalog,
} from "./persistence";
import {
  deleteResourceAccountToken,
  getResourceAccountToken,
  setResourceAccountToken,
} from "./resourceSecretStore";

export interface TorrentCatalogResult {
  id: string;
  title: string;
  input: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  publishedAt?: string;
  detailsUrl?: string;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function stringValue(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function validTorrentInput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  if (/^magnet:\?/i.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Ignore non-network inputs from remote catalogs.
  }

  return undefined;
}

function parseJsonCatalog(
  body: string,
): TorrentCatalogResult[] {
  const parsed = JSON.parse(body) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).results)
      ? (parsed as Record<string, unknown>).results as unknown[]
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as Record<string, unknown>).items)
        ? (parsed as Record<string, unknown>).items as unknown[]
        : [];

  return items.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = stringValue(record, [
      "title",
      "name",
      "filename",
    ]);
    const input = validTorrentInput(
      stringValue(record, [
        "magnet",
        "magnetUrl",
        "magnet_uri",
        "downloadUrl",
        "download_url",
        "torrentUrl",
        "torrent_url",
        "url",
        "link",
      ]),
    );

    if (!title || !input) return [];

    return [{
      id:
        stringValue(record, ["id", "guid", "hash", "infoHash"]) ??
        "json:" + index + ":" + title,
      title,
      input,
      size: numberValue(record.size ?? record.length),
      seeders: numberValue(record.seeders ?? record.seeds),
      leechers: numberValue(
        record.leechers ?? record.peers ?? record.leechs,
      ),
      publishedAt: stringValue(record, [
        "publishedAt",
        "published",
        "pubDate",
        "date",
      ]),
      detailsUrl: stringValue(record, [
        "detailsUrl",
        "details",
      ]),
    }];
  });
}

function childText(
  element: Element,
  localName: string,
): string | undefined {
  const child = Array.from(element.children).find(
    (item) => item.localName.toLowerCase() === localName,
  );
  const text = child?.textContent?.trim();
  return text || undefined;
}

function torznabAttrs(
  item: Element,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const element of Array.from(
    item.getElementsByTagNameNS("*", "attr"),
  )) {
    const name = element.getAttribute("name")?.toLowerCase();
    const value = element.getAttribute("value");
    if (name && value) result.set(name, value);
  }

  return result;
}

function parseXmlCatalog(
  body: string,
  baseUrl: string,
): TorrentCatalogResult[] {
  const document = new DOMParser().parseFromString(
    body,
    "application/xml",
  );

  if (document.querySelector("parsererror")) {
    throw new Error("Torrent catalog returned invalid XML.");
  }

  return Array.from(document.getElementsByTagName("item")).flatMap(
    (item, index) => {
      const attrs = torznabAttrs(item);
      const title = childText(item, "title");
      const enclosure = Array.from(item.children).find(
        (child) => child.localName.toLowerCase() === "enclosure",
      );
      const link = childText(item, "link");

      const candidates = [
        attrs.get("magneturl"),
        attrs.get("downloadurl"),
        enclosure?.getAttribute("url") ?? undefined,
        link,
      ];

      let input: string | undefined;
      for (const candidate of candidates) {
        if (!candidate) continue;

        if (/^magnet:\?/i.test(candidate)) {
          input = candidate;
          break;
        }

        try {
          input = validTorrentInput(
            new URL(candidate, baseUrl).toString(),
          );
        } catch {
          // Try the next candidate.
        }

        if (input) break;
      }

      if (!title || !input) return [];

      const size =
        numberValue(attrs.get("size")) ??
        numberValue(enclosure?.getAttribute("length"));

      return [{
        id:
          childText(item, "guid") ??
          "xml:" + index + ":" + title,
        title,
        input,
        size,
        seeders: numberValue(attrs.get("seeders")),
        leechers:
          numberValue(attrs.get("peers")) ??
          numberValue(attrs.get("leechers")),
        publishedAt: childText(item, "pubdate"),
        detailsUrl: link,
      }];
    },
  );
}

export function parseTorrentCatalog(
  body: string,
  baseUrl: string,
  contentType?: string,
): TorrentCatalogResult[] {
  const trimmed = body.trim();
  const json =
    contentType?.toLowerCase().includes("json") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{");

  return json
    ? parseJsonCatalog(trimmed)
    : parseXmlCatalog(trimmed, baseUrl);
}

function searchUrl(
  template: string,
  query: string,
  apiKey?: string | null,
): string {
  const encodedQuery = encodeURIComponent(query.trim());
  const encodedKey = encodeURIComponent(apiKey ?? "");

  let resolved = template
    .replaceAll("{query}", encodedQuery)
    .replaceAll("{searchTerms}", encodedQuery)
    .replaceAll("{apikey}", encodedKey);

  if (
    !template.includes("{query}") &&
    !template.includes("{searchTerms}")
  ) {
    const url = new URL(resolved);
    url.searchParams.set("q", query.trim());
    resolved = url.toString();
  }

  return resolved;
}

export async function saveTorrentCatalog(
  name: string,
  template: string,
  apiKey?: string,
): Promise<ResourceCatalog> {
  const normalized = template.trim();
  if (!normalized) {
    throw new Error("Torrent catalog search URL/template is required.");
  }

  // Validate after replacing placeholders with inert values.
  const testUrl = searchUrl(normalized, "test", apiKey ?? "");
  const parsed = new URL(testUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Torrent catalog must use HTTP or HTTPS.");
  }

  const catalog = await saveResourceCatalog(
    name.trim() || "Torrent catalog",
    normalized,
    {
      searchTemplate: normalized,
      format: "auto",
    },
    "torrent-catalog",
  );

  if (!catalog) {
    throw new Error("Unable to save the torrent catalog.");
  }

  if (apiKey?.trim()) {
    await setResourceAccountToken(
      "torrent-catalog",
      catalog.id,
      apiKey.trim(),
    );
  }

  return catalog;
}

export async function removeTorrentCatalog(
  catalog: ResourceCatalog,
): Promise<void> {
  await deleteResourceAccountToken(
    "torrent-catalog",
    catalog.id,
  ).catch(() => undefined);
  await removeResourceCatalog(catalog.id);
}

export async function searchTorrentCatalog(
  catalog: ResourceCatalog,
  query: string,
): Promise<TorrentCatalogResult[]> {
  const template =
    typeof catalog.metadata.searchTemplate === "string"
      ? catalog.metadata.searchTemplate
      : catalog.url;
  const apiKey = await getResourceAccountToken(
    "torrent-catalog",
    catalog.id,
  );

  const url = searchUrl(template, query, apiKey);
  const response = await fetchHttpText(url);

  return parseTorrentCatalog(
    response.body,
    response.finalUrl,
    response.contentType,
  );
}

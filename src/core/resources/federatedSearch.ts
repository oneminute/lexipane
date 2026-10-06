import {
  searchCloudAccount,
  type ConnectedCloudAccount,
} from "./cloudAccounts";
import { cloudEntryIsBook, type CloudEntry } from "./cloudTransport";
import {
  searchEd2kEngine,
  type Ed2kEngineAccount,
} from "./ed2kAdapter";
import type { Ed2kSearchResult } from "./ed2kTransport";
import {
  searchArxiv,
  type ArxivResult,
} from "./arxiv";
import {
  searchInternetArchive,
  type InternetArchiveResult,
} from "./internetArchive";
import {
  searchS3Account,
  type ConnectedS3Account,
} from "./s3Accounts";
import {
  searchSftpAccount,
  type ConnectedSftpAccount,
} from "./sftpAccounts";
import {
  sftpEntryIsBook,
  type SftpEntry,
} from "./sftpTransport";
import {
  s3EntryIsBook,
  type S3Entry,
} from "./s3Transport";
import {
  searchWebDavAccount,
  type ConnectedWebDavAccount,
} from "./webdavAccounts";
import {
  webDavEntryIsBook,
  type WebDavEntry,
} from "./webdavTransport";
import {
  searchTorrentCatalog,
  type TorrentCatalogResult,
} from "./torrentCatalog";
import {
  searchOpdsCatalog,
  type OpdsEntry,
  type OpdsLink,
} from "./opds";
import {
  listResourceCatalogs,
  type ResourceCatalog,
} from "./persistence";
import { listLibraryBooks } from "../books/library";
import {
  mimeTypeForResourceBook,
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";

export type FederatedResourceKind =
  | "local"
  | "opds"
  | "cloud"
  | "webdav"
  | "s3"
  | "sftp"
  | "arxiv"
  | "internet-archive"
  | "ed2k"
  | "torrent";

export interface FederatedResourceSource {
  key: string;
  kind: FederatedResourceKind;
  providerId: string;
  sourceLabel: string;
  size?: number;
  mimeType?: string;
  opds?: FederatedResourceResult["opds"];
  cloud?: FederatedResourceResult["cloud"];
  webdav?: FederatedResourceResult["webdav"];
  s3?: FederatedResourceResult["s3"];
  sftp?: FederatedResourceResult["sftp"];
  arxiv?: FederatedResourceResult["arxiv"];
  internetArchive?: FederatedResourceResult["internetArchive"];
  ed2k?: FederatedResourceResult["ed2k"];
  torrent?: FederatedResourceResult["torrent"];
}

export interface FederatedResourceResult {
  key: string;
  kind: FederatedResourceKind;
  providerId: string;
  sourceLabel: string;
  title: string;
  authors: string[];
  description?: string;
  size?: number;
  mimeType?: string;
  localResourceId?: string;
  localPath?: string;
  opds?: {
    catalogId: string;
    catalogUrl: string;
    entry: OpdsEntry;
    acquisition: OpdsLink;
  };
  cloud?: {
    accountId: string;
    entry: CloudEntry;
  };
  webdav?: {
    accountId: string;
    entry: WebDavEntry;
  };
  s3?: {
    accountId: string;
    entry: S3Entry;
  };
  sftp?: {
    accountId: string;
    entry: SftpEntry;
  };
  arxiv?: ArxivResult;
  internetArchive?: InternetArchiveResult;
  ed2k?: {
    accountId: string;
    query: string;
    result: Ed2kSearchResult;
  };
  torrent?: {
    catalogId: string;
    result: TorrentCatalogResult;
  };
  alternatives?: FederatedResourceSource[];
}

export interface FederatedSourceStatus {
  id: string;
  label: string;
  status: "ok" | "error";
  durationMs: number;
  resultCount: number;
  error?: string;
}

export interface FederatedSearchResponse {
  results: FederatedResourceResult[];
  errors: string[];
  searchedSources: number;
  sources: FederatedSourceStatus[];
}

const PROJECT_GUTENBERG_CATALOG: ResourceCatalog = {
  id: "builtin:project-gutenberg",
  providerId: "opds",
  name: "Project Gutenberg",
  url: "https://www.gutenberg.org/ebooks/search.opds/",
  enabled: true,
  metadata: {
    builtin: true,
    publicDomain: true,
  },
  createdAt: "builtin",
  updatedAt: "builtin",
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function relevance(
  query: string,
  title: string,
  authors: string[],
): number {
  const q = normalize(query);
  const t = normalize(title);
  const a = normalize(authors.join(" "));

  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  if (a.includes(q)) return 45;

  const words = q.split(" ").filter(Boolean);
  const haystack = t + " " + a;
  return words.reduce(
    (score, word) => score + (haystack.includes(word) ? 8 : 0),
    0,
  );
}

function opdsResults(
  catalog: ResourceCatalog,
  entries: OpdsEntry[],
): FederatedResourceResult[] {
  return entries.flatMap((entry) => {
    const acquisition = entry.acquisitions.find(
      (link) =>
        supportedResourceBookFormat(link.href, link.type) !== null,
    );

    if (!acquisition) return [];

    return [{
      key:
        "opds:" +
        catalog.id +
        ":" +
        entry.id +
        ":" +
        acquisition.href,
      kind: "opds" as const,
      providerId: "opds",
      sourceLabel: catalog.name,
      title: entry.title,
      authors: entry.authors,
      description: entry.summary,
      mimeType: acquisition.type,
      opds: {
        catalogId: catalog.id,
        catalogUrl: catalog.url,
        entry,
        acquisition,
      },
    }];
  });
}

function cloudResults(
  account: ConnectedCloudAccount,
  entries: CloudEntry[],
): FederatedResourceResult[] {
  return entries
    .filter(cloudEntryIsBook)
    .map((entry) => ({
      key:
        "cloud:" +
        account.id +
        ":" +
        entry.id,
      kind: "cloud" as const,
      providerId: account.providerId,
      sourceLabel:
        account.displayName || account.providerId,
      title: stripSupportedBookExtension(entry.name),
      authors: [],
      size: entry.size,
      mimeType: entry.mimeType,
      cloud: {
        accountId: account.id,
        entry,
      },
    }));
}

function webDavResults(
  account: ConnectedWebDavAccount,
  entries: WebDavEntry[],
): FederatedResourceResult[] {
  return entries
    .filter(webDavEntryIsBook)
    .map((entry) => ({
      key: "webdav:" + account.id + ":" + entry.href,
      kind: "webdav" as const,
      providerId: "webdav",
      sourceLabel: account.displayName || "WebDAV",
      title: stripSupportedBookExtension(entry.name),
      authors: [],
      size: entry.size,
      mimeType: entry.mimeType,
      webdav: {
        accountId: account.id,
        entry,
      },
    }));
}

function s3Results(
  account: ConnectedS3Account,
  entries: S3Entry[],
): FederatedResourceResult[] {
  return entries
    .filter(s3EntryIsBook)
    .map((entry) => ({
      key: "s3:" + account.id + ":" + entry.key,
      kind: "s3" as const,
      providerId: "s3",
      sourceLabel: account.displayName || "S3",
      title: stripSupportedBookExtension(entry.name),
      authors: [],
      size: entry.size,
      s3: {
        accountId: account.id,
        entry,
      },
    }));
}

function sftpResults(
  account: ConnectedSftpAccount,
  entries: SftpEntry[],
): FederatedResourceResult[] {
  return entries
    .filter(sftpEntryIsBook)
    .map((entry) => ({
      key: "sftp:" + account.id + ":" + entry.path,
      kind: "sftp" as const,
      providerId: "sftp",
      sourceLabel: account.displayName || "SFTP",
      title: stripSupportedBookExtension(entry.name),
      authors: [],
      size: entry.size,
      sftp: {
        accountId: account.id,
        entry,
      },
    }));
}

function torrentResults(
  catalog: ResourceCatalog,
  entries: TorrentCatalogResult[],
): FederatedResourceResult[] {
  return entries.map((entry) => ({
    key:
      "torrent:" +
      catalog.id +
      ":" +
      entry.id,
    kind: "torrent" as const,
    providerId: "torrent-catalog",
    sourceLabel: catalog.name,
    title: entry.title,
    authors: [],
    size: entry.size,
    torrent: {
      catalogId: catalog.id,
      result: entry,
    },
  }));
}

function ed2kResults(
  account: Ed2kEngineAccount,
  query: string,
  entries: Ed2kSearchResult[],
): FederatedResourceResult[] {
  return entries
    .filter((entry) => entry.bookCandidate)
    .map((entry) => ({
      key:
        "ed2k:" +
        account.id +
        ":" +
        entry.index +
        ":" +
        entry.name,
      kind: "ed2k" as const,
      providerId: "ed2k",
      sourceLabel: account.displayName || "aMule ED2K",
      title: stripSupportedBookExtension(entry.name),
      authors: [],
      size: entry.size,
      ed2k: {
        accountId: account.id,
        query,
        result: entry,
      },
    }));
}

export async function federatedResourceSearch(
  query: string,
  catalogs: ResourceCatalog[],
  cloudAccounts: ConnectedCloudAccount[],
  ed2kEngines: Ed2kEngineAccount[] = [],
  webDavAccounts: ConnectedWebDavAccount[] = [],
  s3Accounts: ConnectedS3Account[] = [],
  sftpAccounts: ConnectedSftpAccount[] = [],
): Promise<FederatedSearchResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      results: [],
      errors: [],
      searchedSources: 0,
      sources: [],
    };
  }

  const errors: string[] = [];
  const results: FederatedResourceResult[] = [];
  const sources: FederatedSourceStatus[] = [];
  const localStarted = Date.now();
  const localBooks = await listLibraryBooks();

  for (const book of localBooks) {
    const title =
      book.title?.trim() ||
      book.file_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ||
      "Untitled book";
    const authors = book.author?.trim() ? [book.author.trim()] : [];
    const score = relevance(
      normalizedQuery,
      title,
      authors,
    );
    if (score <= 0) continue;

    results.push({
      key: "local:" + book.id,
      kind: "local",
      providerId: "local",
      sourceLabel: "Library",
      title,
      authors,
      mimeType:
        supportedResourceBookFormat(book.file_path)
          ? mimeTypeForResourceBook(
              supportedResourceBookFormat(
                book.file_path,
              )!,
            )
          : undefined,
      localResourceId: book.id,
      localPath: book.file_path,
    });
  }

  sources.push({
    id: "local-library",
    label: "Local Library",
    status: "ok",
    durationMs: Date.now() - localStarted,
    resultCount: results.filter((item) => item.kind === "local").length,
  });

  const tasks: Array<Promise<void>> = [];

  function scheduleSource(
    id: string,
    label: string,
    work: () => Promise<FederatedResourceResult[]>,
  ) {
    const started = Date.now();

    tasks.push(
      work()
        .then((items) => {
          results.push(...items);
          sources.push({
            id,
            label,
            status: "ok",
            durationMs: Date.now() - started,
            resultCount: items.length,
          });
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(label + ": " + message);
          sources.push({
            id,
            label,
            status: "error",
            durationMs: Date.now() - started,
            resultCount: 0,
            error: message,
          });
        }),
    );
  }

  scheduleSource("arxiv", "arXiv", async () =>
    (await searchArxiv(normalizedQuery)).map((item) => ({
      key: "arxiv:" + item.id,
      kind: "arxiv" as const,
      providerId: "arxiv",
      sourceLabel: "arXiv",
      title: item.title,
      authors: item.authors,
      description: item.summary,
      mimeType: "application/pdf",
      arxiv: item,
    })),
  );

  scheduleSource(
    "internet-archive",
    "Internet Archive",
    async () =>
      (await searchInternetArchive(normalizedQuery)).map((item) => ({
        key: "internet-archive:" + item.identifier,
        kind: "internet-archive" as const,
        providerId: "internet-archive",
        sourceLabel: "Internet Archive",
        title: item.title,
        authors: item.authors,
        description: item.description,
        internetArchive: item,
      })),
  );

  scheduleSource(
    PROJECT_GUTENBERG_CATALOG.id,
    PROJECT_GUTENBERG_CATALOG.name,
    async () => {
      const feed = await searchOpdsCatalog(
        PROJECT_GUTENBERG_CATALOG.url,
        normalizedQuery,
      );
      return opdsResults(
        PROJECT_GUTENBERG_CATALOG,
        feed.entries,
      );
    },
  );

  for (const catalog of catalogs) {
    if (catalog.providerId === "torrent-catalog") {
      scheduleSource(
        "catalog:" + catalog.id,
        catalog.name,
        async () =>
          torrentResults(
            catalog,
            await searchTorrentCatalog(catalog, normalizedQuery),
          ),
      );
      continue;
    }

    if (catalog.providerId === "opds") {
      scheduleSource(
        "catalog:" + catalog.id,
        catalog.name,
        async () => {
          const feed = await searchOpdsCatalog(
            catalog.url,
            normalizedQuery,
          );
          return opdsResults(catalog, feed.entries);
        },
      );
    }
  }

  for (const account of cloudAccounts) {
    const label = account.displayName || account.providerId;
    scheduleSource(
      "cloud:" + account.id,
      label,
      async () =>
        cloudResults(
          account,
          (await searchCloudAccount(account, normalizedQuery)).entries,
        ),
    );
  }

  for (const account of sftpAccounts) {
    const label = account.displayName || "SFTP";
    scheduleSource(
      "sftp:" + account.id,
      label,
      async () =>
        sftpResults(
          account,
          (await searchSftpAccount(account, normalizedQuery)).entries,
        ),
    );
  }

  for (const account of s3Accounts) {
    const label = account.displayName || "S3";
    scheduleSource(
      "s3:" + account.id,
      label,
      async () =>
        s3Results(
          account,
          (await searchS3Account(account, normalizedQuery)).entries,
        ),
    );
  }

  for (const account of webDavAccounts) {
    const label = account.displayName || "WebDAV";
    scheduleSource(
      "webdav:" + account.id,
      label,
      async () =>
        webDavResults(
          account,
          (await searchWebDavAccount(account, normalizedQuery)).entries,
        ),
    );
  }

  for (const engine of ed2kEngines) {
    const label = engine.displayName || "aMule ED2K";
    scheduleSource(
      "ed2k:" + engine.id,
      label,
      async () =>
        ed2kResults(
          engine,
          normalizedQuery,
          (
            await searchEd2kEngine(
              engine,
              normalizedQuery,
              "global",
            )
          ).results,
        ),
    );
  }

  await Promise.all(tasks);

  results.sort((left, right) => {
    const scoreDifference =
      relevance(normalizedQuery, right.title, right.authors) -
      relevance(normalizedQuery, left.title, left.authors);

    if (scoreDifference !== 0) return scoreDifference;

    const kindRank: Record<FederatedResourceKind, number> = {
      local: 0,
      cloud: 1,
      webdav: 2,
      s3: 3,
      sftp: 4,
      arxiv: 5,
      "internet-archive": 5,
      opds: 6,
      ed2k: 7,
      torrent: 8,
    };

    return kindRank[left.kind] - kindRank[right.kind];
  });

  const groups = new Map<
    string,
    {
      primary: FederatedResourceResult;
      alternatives: FederatedResourceSource[];
    }
  >();

  function sourceFromResult(
    result: FederatedResourceResult,
  ): FederatedResourceSource {
    return {
      key: result.key,
      kind: result.kind,
      providerId: result.providerId,
      sourceLabel: result.sourceLabel,
      size: result.size,
      mimeType: result.mimeType,
      opds: result.opds,
      cloud: result.cloud,
      webdav: result.webdav,
      s3: result.s3,
      sftp: result.sftp,
      arxiv: result.arxiv,
      internetArchive: result.internetArchive,
      ed2k: result.ed2k,
      torrent: result.torrent,
    };
  }

  function logicalIdentity(result: FederatedResourceResult): string {
    const normalizedTitle = normalize(result.title);
    const normalizedAuthors = normalize(result.authors.join(" "));

    // File size is deliberately not part of logical identity: equivalent
    // editions from different providers can differ slightly because of
    // metadata/container changes. Keep format when known to avoid merging
    // different Reader formats into a single acquisition choice.
    const format =
      supportedResourceBookFormat(
        result.title,
        result.mimeType,
      ) ?? "";

    return [normalizedTitle, normalizedAuthors, format].join("|");
  }

  for (const result of results) {
    const identity = logicalIdentity(result);
    const current = groups.get(identity);

    if (!current) {
      groups.set(identity, {
        primary: result,
        alternatives: [],
      });
      continue;
    }

    current.alternatives.push(sourceFromResult(result));
  }

  const unique = Array.from(groups.values()).map(
    ({ primary, alternatives }) => ({
      ...primary,
      alternatives,
    }),
  );

  return {
    results: unique,
    errors,
    searchedSources: sources.length,
    sources: sources.sort(
      (left, right) =>
        left.status.localeCompare(right.status) ||
        left.durationMs - right.durationMs,
    ),
  };
}

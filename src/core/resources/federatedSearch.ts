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

export interface FederatedSearchResponse {
  results: FederatedResourceResult[];
  errors: string[];
  searchedSources: number;
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
    };
  }

  const errors: string[] = [];
  const results: FederatedResourceResult[] = [];
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

  const tasks: Array<Promise<void>> = [];

  tasks.push(
    searchArxiv(normalizedQuery)
      .then((items) => {
        results.push(
          ...items.map((item) => ({
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
      })
      .catch((error) => {
        errors.push(
          "arXiv: " +
            (error instanceof Error
              ? error.message
              : String(error)),
        );
      }),
  );

  tasks.push(
    searchInternetArchive(normalizedQuery)
      .then((items) => {
        results.push(
          ...items.map((item) => ({
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
      })
      .catch((error) => {
        errors.push(
          "Internet Archive: " +
            (error instanceof Error
              ? error.message
              : String(error)),
        );
      }),
  );

  tasks.push(
    searchOpdsCatalog(
      PROJECT_GUTENBERG_CATALOG.url,
      normalizedQuery,
    )
      .then((feed) => {
        results.push(
          ...opdsResults(
            PROJECT_GUTENBERG_CATALOG,
            feed.entries,
          ),
        );
      })
      .catch((error) => {
        errors.push(
          "Project Gutenberg: " +
            (error instanceof Error
              ? error.message
              : String(error)),
        );
      }),
  );

  for (const catalog of catalogs) {
    if (catalog.providerId === "torrent-catalog") {
      tasks.push(
        searchTorrentCatalog(catalog, normalizedQuery)
          .then((entries) => {
            results.push(...torrentResults(catalog, entries));
          })
          .catch((error) => {
            errors.push(
              catalog.name +
                ": " +
                (error instanceof Error
                  ? error.message
                  : String(error)),
            );
          }),
      );
      continue;
    }

    if (catalog.providerId === "opds") {
      tasks.push(
        searchOpdsCatalog(catalog.url, normalizedQuery)
          .then((feed) => {
            results.push(...opdsResults(catalog, feed.entries));
          })
          .catch((error) => {
            errors.push(
              catalog.name +
                ": " +
                (error instanceof Error
                  ? error.message
                  : String(error)),
            );
          }),
      );
    }
  }

  for (const account of cloudAccounts) {
    tasks.push(
      searchCloudAccount(account, normalizedQuery)
        .then((response) => {
          results.push(
            ...cloudResults(account, response.entries),
          );
        })
        .catch((error) => {
          errors.push(
            (account.displayName || account.providerId) +
              ": " +
              (error instanceof Error
                ? error.message
                : String(error)),
          );
        }),
    );
  }

  for (const account of sftpAccounts) {
    tasks.push(
      searchSftpAccount(account, normalizedQuery)
        .then((response) => {
          results.push(...sftpResults(account, response.entries));
        })
        .catch((error) => {
          errors.push(
            (account.displayName || "SFTP") +
              ": " +
              (error instanceof Error
                ? error.message
                : String(error)),
          );
        }),
    );
  }

  for (const account of s3Accounts) {
    tasks.push(
      searchS3Account(account, normalizedQuery)
        .then((response) => {
          results.push(...s3Results(account, response.entries));
        })
        .catch((error) => {
          errors.push(
            (account.displayName || "S3") +
              ": " +
              (error instanceof Error
                ? error.message
                : String(error)),
          );
        }),
    );
  }

  for (const account of webDavAccounts) {
    tasks.push(
      searchWebDavAccount(account, normalizedQuery)
        .then((response) => {
          results.push(
            ...webDavResults(account, response.entries),
          );
        })
        .catch((error) => {
          errors.push(
            (account.displayName || "WebDAV") +
              ": " +
              (error instanceof Error
                ? error.message
                : String(error)),
          );
        }),
    );
  }

  for (const engine of ed2kEngines) {
    tasks.push(
      searchEd2kEngine(engine, normalizedQuery, "global")
        .then((response) => {
          results.push(
            ...ed2kResults(
              engine,
              normalizedQuery,
              response.results,
            ),
          );
        })
        .catch((error) => {
          errors.push(
            (engine.displayName || "aMule ED2K") +
              ": " +
              (error instanceof Error
                ? error.message
                : String(error)),
          );
        }),
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
    searchedSources:
      catalogs.length +
      cloudAccounts.length +
      ed2kEngines.length +
      webDavAccounts.length +
      s3Accounts.length +
      sftpAccounts.length +
      4,
  };
}

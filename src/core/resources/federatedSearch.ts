import {
  searchCloudAccount,
  type ConnectedCloudAccount,
} from "./cloudAccounts";
import { cloudEntryIsBook, type CloudEntry } from "./cloudTransport";
import {
  searchOpdsCatalog,
  type OpdsEntry,
  type OpdsLink,
} from "./opds";
import {
  listResourceCatalogs,
  listResourceItems,
  type ResourceCatalog,
} from "./persistence";

export type FederatedResourceKind = "local" | "opds" | "cloud";

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
}

export interface FederatedSearchResponse {
  results: FederatedResourceResult[];
  errors: string[];
  searchedSources: number;
}

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
        link.type === "application/epub+zip" ||
        link.type === "application/pdf" ||
        /\.(epub|pdf)(?:\?|$)/i.test(link.href),
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
      title: entry.name.replace(/\.(pdf|epub)$/i, ""),
      authors: [],
      size: entry.size,
      mimeType: entry.mimeType,
      cloud: {
        accountId: account.id,
        entry,
      },
    }));
}

export async function federatedResourceSearch(
  query: string,
  catalogs: ResourceCatalog[],
  cloudAccounts: ConnectedCloudAccount[],
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
  const localItems = await listResourceItems(300);

  for (const item of localItems) {
    const score = relevance(
      normalizedQuery,
      item.title,
      item.authors,
    );
    if (score <= 0) continue;

    results.push({
      key: "local:" + item.id,
      kind: "local",
      providerId: "local",
      sourceLabel: "Resource history",
      title: item.title,
      authors: item.authors,
      description: item.description,
      localResourceId: item.id,
    });
  }

  const tasks: Array<Promise<void>> = [];

  for (const catalog of catalogs) {
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

  await Promise.all(tasks);

  results.sort((left, right) => {
    const scoreDifference =
      relevance(normalizedQuery, right.title, right.authors) -
      relevance(normalizedQuery, left.title, left.authors);

    if (scoreDifference !== 0) return scoreDifference;

    const kindRank: Record<FederatedResourceKind, number> = {
      local: 0,
      cloud: 1,
      opds: 2,
    };

    return kindRank[left.kind] - kindRank[right.kind];
  });

  const seen = new Set<string>();
  const unique = results.filter((result) => {
    const identity = [
      normalize(result.title),
      normalize(result.authors.join(" ")),
      result.mimeType ?? "",
      result.size ?? "",
    ].join("|");

    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  return {
    results: unique,
    errors,
    searchedSources:
      catalogs.length + cloudAccounts.length + 1,
  };
}

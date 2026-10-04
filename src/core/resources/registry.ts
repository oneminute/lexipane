import type { ResourceProviderDescriptor } from "./types";

export const BUILTIN_RESOURCE_PROVIDERS: ResourceProviderDescriptor[] = [
  {
    id: "http",
    name: "HTTP / HTTPS",
    kind: "transport",
    description: "Direct web resources and future resumable downloads.",
    builtin: true,
    live: true,
    capabilities: {
      resolve: true,
      preview: true,
      previewLevels: [0],
      download: true,
    },
  },
  {
    id: "opds",
    name: "OPDS",
    kind: "catalog",
    description: "Book catalogs, metadata, covers, and acquisition links.",
    builtin: true,
    live: true,
    capabilities: {
      search: true,
      browse: true,
      resolve: true,
      preview: true,
      previewLevels: [0, 1, 2],
      fileList: true,
      download: true,
      authentication: true,
    },
  },
  {
    id: "google-drive",
    name: "Google Drive",
    kind: "storage",
    description: "User-owned Google Drive files and folders.",
    builtin: true,
    live: false,
    capabilities: {
      search: true,
      browse: true,
      resolve: true,
      preview: true,
      previewLevels: [0, 1, 2],
      fileList: true,
      download: true,
      upload: true,
      authentication: true,
    },
  },
  {
    id: "dropbox",
    name: "Dropbox",
    kind: "storage",
    description: "User-owned Dropbox files and shared links.",
    builtin: true,
    live: false,
    capabilities: {
      search: true,
      browse: true,
      resolve: true,
      preview: true,
      previewLevels: [0, 1, 2],
      fileList: true,
      download: true,
      upload: true,
      authentication: true,
    },
  },
  {
    id: "onedrive",
    name: "OneDrive / SharePoint",
    kind: "storage",
    description: "User-owned Microsoft drive and document-library resources.",
    builtin: true,
    live: false,
    capabilities: {
      search: true,
      browse: true,
      resolve: true,
      preview: true,
      previewLevels: [0, 1, 2],
      fileList: true,
      download: true,
      upload: true,
      authentication: true,
    },
  },
  {
    id: "bittorrent",
    name: "BitTorrent",
    kind: "p2p",
    description: "Native magnet/torrent metadata preview and selective PDF/EPUB transfer.",
    builtin: true,
    live: true,
    capabilities: {
      resolve: true,
      preview: true,
      previewLevels: [0, 1, 3],
      fileList: true,
      download: true,
      stream: true,
    },
  },
  {
    id: "ed2k",
    name: "ED2K",
    kind: "p2p",
    description: "ED2K search/transfer contract. Sidecar/native networking is not enabled yet.",
    builtin: true,
    live: false,
    capabilities: {
      search: true,
      resolve: true,
      preview: true,
      previewLevels: [0, 1],
      fileList: true,
      download: true,
    },
  },
];

const providerMap = new Map(
  BUILTIN_RESOURCE_PROVIDERS.map((provider) => [provider.id, provider]),
);

export function listResourceProviders(): ResourceProviderDescriptor[] {
  return [...providerMap.values()];
}

export function getResourceProvider(
  id: string,
): ResourceProviderDescriptor | null {
  return providerMap.get(id) ?? null;
}

export function registerResourceProvider(
  descriptor: ResourceProviderDescriptor,
): void {
  providerMap.set(descriptor.id, descriptor);
}

export function resourceProviderSupports(
  providerId: string,
  capability: keyof ResourceProviderDescriptor["capabilities"],
): boolean {
  const provider = providerMap.get(providerId);
  if (!provider) return false;

  const value = provider.capabilities[capability];

  if (capability === "previewLevels") {
    return Array.isArray(value) && value.length > 0;
  }

  return value === true;
}

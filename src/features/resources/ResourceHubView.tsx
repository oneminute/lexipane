import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelHttpDownload,
  discardHttpTransfer,
  pauseHttpDownload,
  prepareHttpAcquisition,
  resumeHttpTransfer,
  startHttpAcquisition,
  startPreparedHttpAcquisition,
  type HttpAcquisitionPreparation,
} from "../../core/resources/acquisition";
import { getResourceNativeCapabilities } from "../../core/resources/native";
import {
  DEFAULT_RESOURCE_TRANSFER_CONCURRENCY,
  loadResourceTransferConcurrency,
  saveResourceTransferConcurrency,
} from "../../core/resources/preferences";
import {
  browseCloudAccount,
  cancelCloudDownload,
  connectCloudAccount,
  disconnectCloudAccount,
  discardCloudTransfer,
  listConnectedCloudAccounts,
  pauseCloudDownload,
  resumeCloudTransfer,
  searchCloudAccount,
  startCloudEntryAcquisition,
  type ConnectedCloudAccount,
} from "../../core/resources/cloudAccounts";
import {
  cloudEntryIsBook,
  cloudFolderLocator,
  type CloudEntry,
  type CloudProviderId,
} from "../../core/resources/cloudTransport";
import {
  browseWebDavAccount,
  cancelWebDavDownload,
  connectWebDavAccount,
  disconnectWebDavAccount,
  discardWebDavTransfer,
  listWebDavAccounts,
  pauseWebDavDownload,
  resumeWebDavTransfer,
  searchWebDavAccount,
  startWebDavEntryAcquisition,
  type ConnectedWebDavAccount,
} from "../../core/resources/webdavAccounts";
import {
  webDavEntryIsBook,
  type WebDavEntry,
} from "../../core/resources/webdavTransport";
import {
  browseS3Account,
  cancelS3Download,
  connectS3Account,
  disconnectS3Account,
  discardS3Transfer,
  listS3Accounts,
  pauseS3Download,
  resumeS3Transfer,
  searchS3Account,
  startS3EntryAcquisition,
  type ConnectedS3Account,
} from "../../core/resources/s3Accounts";
import {
  s3EntryIsBook,
  type S3Entry,
} from "../../core/resources/s3Transport";
import {
  browseSftpAccount,
  cancelSftpDownload,
  connectSftpAccount,
  disconnectSftpAccount,
  discardSftpTransfer,
  listSftpAccounts,
  pauseSftpDownload,
  resumeSftpTransfer,
  searchSftpAccount,
  startSftpEntryAcquisition,
  type ConnectedSftpAccount,
} from "../../core/resources/sftpAccounts";
import {
  sftpEntryIsBook,
  type SftpEntry,
} from "../../core/resources/sftpTransport";
import { supportedResourceBookFormat } from "../../core/resources/bookFormats";
import {
  cancelTorrentDownload,
  discardTorrentTransfer,
  inspectTorrent,
  pauseTorrentDownload,
  prepareTorrentAcquisition,
  resumeTorrentTransfer,
  startPreparedTorrentAcquisition,
} from "../../core/resources/torrentAcquisition";
import type {
  TorrentPreviewResult,
} from "../../core/resources/torrentTransport";
import {
  resolveInternetArchiveAcquisitions,
} from "../../core/resources/internetArchive";
import {
  fetchOpdsCatalog,
  searchOpdsCatalog,
  type OpdsEntry,
  type OpdsFeed,
  type OpdsLink,
} from "../../core/resources/opds";
import {
  clearFinishedTransferJobs,
  createDraftTransferJob,
  listPersistedResourceProviders,
  listResourceCatalogs,
  listResourceItems,
  listTransferJobs,
  removeResourceCatalog,
  saveResourceCatalog,
  syncBuiltinResourceProviders,
  type PersistedResourceProvider,
  type ResourceCatalog,
} from "../../core/resources/persistence";
import {
  listResourceProviders,
} from "../../core/resources/registry";
import { classifyResourceInput } from "../../core/resources/resolver";
import {
  isSupportedCloudShareKind,
  prepareCloudShareAcquisition,
} from "../../core/resources/sharedLinks";
import {
  federatedResourceSearch,
  type FederatedResourceResult,
  type FederatedSourceStatus,
} from "../../core/resources/federatedSearch";
import {
  RESOURCE_TRANSFER_UPDATED_EVENT,
} from "../../core/resources/runtime";
import {
  cancelEd2kTransfer,
  connectEd2kEngine,
  disconnectEd2kEngine,
  listEd2kEngines,
  parseEd2kLink,
  pauseEd2kTransfer,
  resumeEd2kTransfer,
  searchEd2kEngine,
  startEd2kLinkAcquisition,
  startEd2kSearchResultAcquisition,
  type Ed2kEngineAccount,
} from "../../core/resources/ed2kAdapter";
import type {
  Ed2kLinkMetadata,
  Ed2kSearchResult,
} from "../../core/resources/ed2kTransport";
import type {
  ResourceInputClassification,
  ResourceItem,
  ResourceNativeCapabilities,
  ResourceProviderCapabilities,
  ResourceProviderKind,
  TransferJob,
} from "../../core/resources/types";

type ResourceHubTab = "search" | "browse" | "downloads" | "accounts";

interface Props {
  onOpenBook: (path: string) => void | Promise<void>;
}

interface ProviderView {
  id: string;
  name: string;
  kind: ResourceProviderKind;
  capabilities: ResourceProviderCapabilities;
  builtin: boolean;
  live: boolean;
  enabled: boolean;
}

const tabs: Array<{ id: ResourceHubTab; label: string }> = [
  { id: "search", label: "Search" },
  { id: "browse", label: "Browse" },
  { id: "downloads", label: "Downloads" },
  { id: "accounts", label: "Accounts" },
];

function providerView(
  provider: PersistedResourceProvider,
): ProviderView {
  return {
    id: provider.id,
    name: provider.displayName,
    kind: provider.kind,
    capabilities: provider.capabilities,
    builtin: provider.builtin,
    live: provider.live,
    enabled: provider.enabled,
  };
}

function fallbackProviderViews(): ProviderView[] {
  return listResourceProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    capabilities: provider.capabilities,
    builtin: provider.builtin,
    live: provider.live,
    enabled: true,
  }));
}

function capabilityLabels(
  capabilities: ResourceProviderCapabilities,
): string[] {
  const labels: string[] = [];

  if (capabilities.search) labels.push("search");
  if (capabilities.browse) labels.push("browse");
  if (capabilities.resolve) labels.push("resolve");
  if (capabilities.fileList) labels.push("file list");
  if (capabilities.download) labels.push("download");
  if (capabilities.stream) labels.push("stream");
  if (capabilities.upload) labels.push("upload");
  if (capabilities.authentication) labels.push("auth");

  if (capabilities.previewLevels?.length) {
    labels.push(
      "preview " +
        capabilities.previewLevels
          .map((level) => "L" + level)
          .join("/"),
    );
  }

  return labels;
}

function classificationTitle(
  classification: ResourceInputClassification,
): string {
  switch (classification.kind) {
    case "google-drive":
      return "Google Drive share";
    case "dropbox":
      return "Dropbox resource";
    case "onedrive":
      return "OneDrive / SharePoint resource";
    case "opds":
      return "OPDS catalog";
    case "magnet":
      return "BitTorrent magnet";
    case "torrent":
      return "Torrent metadata";
    case "ed2k":
      return "ED2K resource";
    case "http":
      return "HTTP / HTTPS resource";
    case "webdav":
      return "WebDAV resource";
    case "s3":
      return "S3 resource";
    case "sftp":
      return "SFTP resource";
    default:
      return "Unknown resource input";
  }
}

function transferLabel(job: TransferJob): string {
  const input = job.resumeData?.resourceInput;
  return typeof input === "string" && input.trim()
    ? input
    : job.transportType;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "Unknown";

  const units = ["B", "KB", "MB", "GB"];
  let size = Math.max(0, value);
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return (
    size.toLocaleString(undefined, {
      maximumFractionDigits: index === 0 ? 0 : 1,
    }) +
    " " +
    units[index]
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return rounded + "s";

  const minutes = Math.floor(rounded / 60);
  const restSeconds = rounded % 60;
  if (minutes < 60) {
    return minutes + "m " + restSeconds + "s";
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return hours + "h " + restMinutes + "m";
}

function transferEta(job: TransferJob): string | null {
  if (
    job.state !== "running" ||
    !job.bytesTotal ||
    !job.downloadRate ||
    job.downloadRate <= 0
  ) {
    return null;
  }

  const remaining = Math.max(
    0,
    job.bytesTotal - job.bytesCompleted,
  );
  return formatDuration(remaining / job.downloadRate);
}

function opdsLinkLabel(link: OpdsLink): string {
  const type = link.type?.toLowerCase() ?? "";
  const href = link.href.toLowerCase();

  if (type === "application/epub+zip" || /\.epub(?:\?|$)/.test(href)) {
    return "Get EPUB";
  }
  if (type === "application/pdf" || /\.pdf(?:\?|$)/.test(href)) {
    return "Get PDF";
  }
  if (
    type.includes("mobipocket") ||
    /\.mobi(?:\?|$)/.test(href)
  ) {
    return "Get MOBI";
  }
  if (/\.azw3(?:\?|$)/.test(href)) return "Get AZW3";
  if (
    type.includes("amazon.ebook") ||
    /\.azw(?:\?|$)/.test(href)
  ) {
    return "Get AZW";
  }

  return link.title || "Get book";
}

export function ResourceHubView({ onOpenBook }: Props) {
  const [tab, setTab] = useState<ResourceHubTab>("search");
  const [transferFilter, setTransferFilter] =
    useState<"active" | "completed" | "failed" | "all">("active");
  const [transferConcurrency, setTransferConcurrency] = useState<number>(
    DEFAULT_RESOURCE_TRANSFER_CONCURRENCY,
  );
  const [input, setInput] = useState("");
  const [classification, setClassification] =
    useState<ResourceInputClassification | null>(null);
  const [providers, setProviders] =
    useState<ProviderView[]>(fallbackProviderViews);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [catalogs, setCatalogs] = useState<ResourceCatalog[]>([]);
  const [nativeCapabilities, setNativeCapabilities] =
    useState<ResourceNativeCapabilities | null>(null);
  const [httpPreparation, setHttpPreparation] =
    useState<HttpAcquisitionPreparation | null>(null);
  const [torrentPreview, setTorrentPreview] =
    useState<TorrentPreviewResult | null>(null);
  const [torrentSelectedFileIndex, setTorrentSelectedFileIndex] =
    useState<number | null>(null);
  const [networkBusy, setNetworkBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceSearchBusy, setResourceSearchBusy] = useState(false);
  const [resourceSearchResults, setResourceSearchResults] =
    useState<FederatedResourceResult[]>([]);
  const [resourceSearchErrors, setResourceSearchErrors] =
    useState<string[]>([]);
  const [resourceSearchSourceCount, setResourceSearchSourceCount] =
    useState(0);
  const [resourceSearchSources, setResourceSearchSources] =
    useState<FederatedSourceStatus[]>([]);
  const [resourceFormatFilter, setResourceFormatFilter] =
    useState<"all" | "pdf" | "epub" | "mobi" | "azw" | "azw3">("all");
  const [resourceSourceFilter, setResourceSourceFilter] =
    useState<"all" | "local" | "storage" | "public" | "p2p">("all");
  const resourceSearchTokenRef = useRef(0);

  const [catalogName, setCatalogName] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
  const [activeCatalog, setActiveCatalog] =
    useState<ResourceCatalog | null>(null);
  const [opdsFeed, setOpdsFeed] = useState<OpdsFeed | null>(null);
  const [opdsQuery, setOpdsQuery] = useState("");
  const [opdsBusy, setOpdsBusy] = useState(false);
  const [cloudAccounts, setCloudAccounts] =
    useState<ConnectedCloudAccount[]>([]);
  const [activeCloudAccountId, setActiveCloudAccountId] =
    useState<string | null>(null);
  const [cloudEntries, setCloudEntries] = useState<CloudEntry[]>([]);
  const [cloudFolder, setCloudFolder] = useState<string | undefined>(
    undefined,
  );
  const [cloudFolderStack, setCloudFolderStack] = useState<
    Array<{ label: string; locator?: string }>
  >([{ label: "Root" }]);
  const [cloudQuery, setCloudQuery] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [connectProvider, setConnectProvider] =
    useState<CloudProviderId>("google-drive");
  const [connectDisplayName, setConnectDisplayName] = useState("");
  const [connectToken, setConnectToken] = useState("");
  const [connectRefreshToken, setConnectRefreshToken] = useState("");
  const [connectClientId, setConnectClientId] = useState("");
  const [connectClientSecret, setConnectClientSecret] = useState("");
  const [connectTenant, setConnectTenant] = useState("common");
  const [webDavAccounts, setWebDavAccounts] =
    useState<ConnectedWebDavAccount[]>([]);
  const [activeWebDavAccountId, setActiveWebDavAccountId] =
    useState<string | null>(null);
  const [webDavEntries, setWebDavEntries] = useState<WebDavEntry[]>([]);
  const [webDavPath, setWebDavPath] = useState<string | undefined>(
    undefined,
  );
  const [webDavFolderStack, setWebDavFolderStack] = useState<
    Array<{ label: string; locator?: string }>
  >([{ label: "Root" }]);
  const [webDavQuery, setWebDavQuery] = useState("");
  const [webDavBusy, setWebDavBusy] = useState(false);
  const [webDavDisplayName, setWebDavDisplayName] = useState("");
  const [webDavBaseUrl, setWebDavBaseUrl] = useState("");
  const [webDavUsername, setWebDavUsername] = useState("");
  const [webDavPassword, setWebDavPassword] = useState("");
  const [s3Accounts, setS3Accounts] =
    useState<ConnectedS3Account[]>([]);
  const [activeS3AccountId, setActiveS3AccountId] =
    useState<string | null>(null);
  const [s3Entries, setS3Entries] = useState<S3Entry[]>([]);
  const [s3Prefix, setS3Prefix] = useState<string | undefined>(
    undefined,
  );
  const [s3FolderStack, setS3FolderStack] = useState<
    Array<{ label: string; prefix?: string }>
  >([{ label: "Root" }]);
  const [s3Query, setS3Query] = useState("");
  const [s3Busy, setS3Busy] = useState(false);
  const [s3DisplayName, setS3DisplayName] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3RootPrefix, setS3RootPrefix] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3SessionToken, setS3SessionToken] = useState("");
  const [sftpAccounts, setSftpAccounts] =
    useState<ConnectedSftpAccount[]>([]);
  const [activeSftpAccountId, setActiveSftpAccountId] =
    useState<string | null>(null);
  const [sftpEntries, setSftpEntries] = useState<SftpEntry[]>([]);
  const [sftpPath, setSftpPath] = useState<string | undefined>(
    undefined,
  );
  const [sftpFolderStack, setSftpFolderStack] = useState<
    Array<{ label: string; path?: string }>
  >([{ label: "Root" }]);
  const [sftpQuery, setSftpQuery] = useState("");
  const [sftpBusy, setSftpBusy] = useState(false);
  const [sftpDisplayName, setSftpDisplayName] = useState("");
  const [sftpHost, setSftpHost] = useState("");
  const [sftpPort, setSftpPort] = useState("22");
  const [sftpUsername, setSftpUsername] = useState("");
  const [sftpPassword, setSftpPassword] = useState("");
  const [sftpPrivateKeyPath, setSftpPrivateKeyPath] = useState("");
  const [sftpPrivateKeyPassphrase, setSftpPrivateKeyPassphrase] =
    useState("");
  const [sftpRootPath, setSftpRootPath] = useState("/");
  const [ed2kEngines, setEd2kEngines] =
    useState<Ed2kEngineAccount[]>([]);
  const [activeEd2kEngineId, setActiveEd2kEngineId] =
    useState<string | null>(null);
  const [ed2kExecutable, setEd2kExecutable] = useState("");
  const [ed2kHost, setEd2kHost] = useState("127.0.0.1");
  const [ed2kPort, setEd2kPort] = useState("4712");
  const [ed2kPassword, setEd2kPassword] = useState("");
  const [ed2kIncomingDir, setEd2kIncomingDir] = useState("");
  const [ed2kBusy, setEd2kBusy] = useState(false);
  const [ed2kQuery, setEd2kQuery] = useState("");
  const [ed2kSearchType, setEd2kSearchType] =
    useState<"global" | "kad" | "local">("global");
  const [ed2kResults, setEd2kResults] =
    useState<Ed2kSearchResult[]>([]);
  const [ed2kLinkMetadata, setEd2kLinkMetadata] =
    useState<Ed2kLinkMetadata | null>(null);

  const visibleResourceSearchResults = useMemo(() => {
    return resourceSearchResults.filter((result) => {
      const format =
        supportedResourceBookFormat(
          result.title,
          result.mimeType,
        );

      if (
        resourceFormatFilter !== "all" &&
        format !== resourceFormatFilter
      ) {
        return false;
      }

      if (resourceSourceFilter === "all") return true;
      if (resourceSourceFilter === "local") {
        return result.kind === "local";
      }
      if (resourceSourceFilter === "storage") {
        return (
          result.kind === "cloud" ||
          result.kind === "webdav" ||
          result.kind === "s3" ||
          result.kind === "sftp"
        );
      }
      if (resourceSourceFilter === "public") {
        return (
          result.kind === "opds" ||
          result.kind === "arxiv" ||
          result.kind === "internet-archive"
        );
      }

      return result.kind === "ed2k" || result.kind === "torrent";
    });
  }, [
    resourceSearchResults,
    resourceFormatFilter,
    resourceSourceFilter,
  ]);

  const visibleTransfers = useMemo(() => {
    if (transferFilter === "all") return transfers;

    if (transferFilter === "completed") {
      return transfers.filter(
        (job) =>
          job.state === "completed" || job.state === "canceled",
      );
    }

    if (transferFilter === "failed") {
      return transfers.filter((job) => job.state === "failed");
    }

    return transfers.filter(
      (job) =>
        job.state === "draft" ||
        job.state === "queued" ||
        job.state === "running" ||
        job.state === "paused" ||
        job.state === "downloaded" ||
        job.state === "ingesting",
    );
  }, [transfers, transferFilter]);

  async function changeTransferConcurrency(value: number) {
    try {
      const applied = await saveResourceTransferConcurrency(value);
      setTransferConcurrency(applied);
      setMessage(
        "Direct download concurrency set to " + applied + ".",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update transfer concurrency.",
      );
    }
  }

  async function clearFinishedDownloads() {
    try {
      const count = await clearFinishedTransferJobs();
      await refreshResourceCore();
      setMessage(
        count > 0
          ? "Cleared " + count + " finished transfer job(s)."
          : "There are no finished transfer jobs to clear.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to clear finished downloads.",
      );
    }
  }

  const liveTransportCount = useMemo(() => {
    if (!nativeCapabilities) return 0;
    return Object.values(nativeCapabilities.liveTransports).filter(Boolean)
      .length;
  }, [nativeCapabilities]);

  async function refreshResourceCore() {
    const [
      native,
      persistedProviders,
      jobs,
      items,
      savedCatalogs,
      connectedCloudAccounts,
      connectedEd2kEngines,
      connectedWebDavAccounts,
      connectedS3Accounts,
      connectedSftpAccounts,
      configuredConcurrency,
    ] = await Promise.all([
      getResourceNativeCapabilities(),
      listPersistedResourceProviders(),
      listTransferJobs(),
      listResourceItems(),
      listResourceCatalogs(),
      listConnectedCloudAccounts(),
      listEd2kEngines(),
      listWebDavAccounts(),
      listS3Accounts(),
      listSftpAccounts(),
      loadResourceTransferConcurrency(),
    ]);

    setNativeCapabilities(native);
    setProviders(
      persistedProviders.length > 0
        ? persistedProviders.map(providerView)
        : fallbackProviderViews(),
    );
    setTransfers(jobs);
    setResources(items);
    setCatalogs(savedCatalogs);
    setCloudAccounts(connectedCloudAccounts);
    setWebDavAccounts(connectedWebDavAccounts);
    setS3Accounts(connectedS3Accounts);
    setSftpAccounts(connectedSftpAccounts);
    setTransferConcurrency(configuredConcurrency);
    setEd2kEngines(connectedEd2kEngines);
    setActiveEd2kEngineId((current) =>
      current &&
      connectedEd2kEngines.some((engine) => engine.id === current)
        ? current
        : connectedEd2kEngines[0]?.id ?? null,
    );
    setActiveCloudAccountId((current) =>
      current &&
      connectedCloudAccounts.some((account) => account.id === current)
        ? current
        : connectedCloudAccounts[0]?.id ?? null,
    );
    setActiveWebDavAccountId((current) =>
      current &&
      connectedWebDavAccounts.some((account) => account.id === current)
        ? current
        : connectedWebDavAccounts[0]?.id ?? null,
    );
    setActiveS3AccountId((current) =>
      current &&
      connectedS3Accounts.some((account) => account.id === current)
        ? current
        : connectedS3Accounts[0]?.id ?? null,
    );
    setActiveSftpAccountId((current) =>
      current &&
      connectedSftpAccounts.some((account) => account.id === current)
        ? current
        : connectedSftpAccounts[0]?.id ?? null,
    );
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await syncBuiltinResourceProviders();

        if (cancelled) return;
        await refreshResourceCore();
      } catch (error) {
        console.error("Unable to initialize Resource Hub", error);
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to initialize Resource Hub.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleTransferUpdate = () => {
      void refreshResourceCore().catch((error) => {
        console.error("Unable to refresh Resource Hub transfers", error);
      });
    };

    globalThis.addEventListener(
      RESOURCE_TRANSFER_UPDATED_EVENT,
      handleTransferUpdate,
    );

    return () => {
      globalThis.removeEventListener(
        RESOURCE_TRANSFER_UPDATED_EVENT,
        handleTransferUpdate,
      );
    };
  }, []);

  async function runFederatedSearch() {
    if (!resourceQuery.trim()) return;

    const requestToken = ++resourceSearchTokenRef.current;
    setResourceSearchBusy(true);
    setResourceSearchErrors([]);
    setResourceSearchSources([]);
    setMessage("");

    try {
      const response = await federatedResourceSearch(
        resourceQuery,
        catalogs,
        cloudAccounts,
        ed2kEngines,
        webDavAccounts,
        s3Accounts,
        sftpAccounts,
      );

      if (resourceSearchTokenRef.current !== requestToken) return;

      setResourceSearchResults(response.results);
      setResourceSearchErrors(response.errors);
      setResourceSearchSourceCount(response.searchedSources);
      setResourceSearchSources(response.sources);
    } catch (error) {
      if (resourceSearchTokenRef.current !== requestToken) return;

      setMessage(
        error instanceof Error
          ? error.message
          : "Federated resource search failed.",
      );
    } finally {
      if (resourceSearchTokenRef.current === requestToken) {
        setResourceSearchBusy(false);
      }
    }
  }

  function cancelFederatedSearch() {
    resourceSearchTokenRef.current += 1;
    setResourceSearchBusy(false);
    setMessage(
      "Search canceled. Any provider requests already in flight will be ignored when they finish.",
    );
  }

  function alternativeAsResult(
    parent: FederatedResourceResult,
    source: NonNullable<FederatedResourceResult["alternatives"]>[number],
  ): FederatedResourceResult {
    return {
      ...parent,
      key: source.key,
      kind: source.kind,
      providerId: source.providerId,
      sourceLabel: source.sourceLabel,
      size: source.size ?? parent.size,
      mimeType: source.mimeType ?? parent.mimeType,
      opds: source.opds,
      cloud: source.cloud,
      webdav: source.webdav,
      s3: source.s3,
      sftp: source.sftp,
      arxiv: source.arxiv,
      internetArchive: source.internetArchive,
      ed2k: source.ed2k,
      torrent: source.torrent,
      alternatives: [],
    };
  }

  async function acquireFederatedResult(
    result: FederatedResourceResult,
  ) {
    if (result.opds) {
      setNetworkBusy(true);
      setMessage("");

      try {
        await startHttpAcquisition(
          result.opds.acquisition.href,
          {
            title: result.opds.entry.title,
            authors: result.opds.entry.authors,
            opdsCatalogUrl: result.opds.catalogUrl,
            opdsEntryId: result.opds.entry.id,
            acquisitionType:
              result.opds.acquisition.type,
          },
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the OPDS result.",
        );
      } finally {
        setNetworkBusy(false);
      }
      return;
    }

    if (result.cloud) {
      const account = cloudAccounts.find(
        (item) => item.id === result.cloud?.accountId,
      );
      if (!account) {
        setMessage("The cloud account is no longer connected.");
        return;
      }

      setCloudBusy(true);
      setMessage("");

      try {
        await startCloudEntryAcquisition(
          account,
          result.cloud.entry,
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the cloud result.",
        );
      } finally {
        setCloudBusy(false);
      }
      return;
    }

    if (result.webdav) {
      const account = webDavAccounts.find(
        (item) => item.id === result.webdav?.accountId,
      );
      if (!account) {
        setMessage("The WebDAV account is no longer connected.");
        return;
      }

      setWebDavBusy(true);
      setMessage("");

      try {
        await startWebDavEntryAcquisition(
          account,
          result.webdav.entry,
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the WebDAV result.",
        );
      } finally {
        setWebDavBusy(false);
      }
      return;
    }

    if (result.arxiv) {
      setNetworkBusy(true);
      setMessage("");

      try {
        await startHttpAcquisition(
          result.arxiv.pdfUrl,
          {
            title: result.arxiv.title,
            authors: result.arxiv.authors,
            acquisitionType: "application/pdf",
            catalogProviderId: "arxiv",
            catalogSourceKey: result.arxiv.id,
            catalogUrl:
              "https://arxiv.org/abs/" +
              encodeURIComponent(result.arxiv.id),
            catalogMetadata: {
              arxivId: result.arxiv.id,
              categories: result.arxiv.categories,
              publishedAt: result.arxiv.publishedAt,
              updatedAt: result.arxiv.updatedAt,
            },
          },
        );

        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the arXiv paper.",
        );
      } finally {
        setNetworkBusy(false);
      }
      return;
    }

    if (result.internetArchive) {
      setNetworkBusy(true);
      setMessage("");

      try {
        const acquisitions =
          await resolveInternetArchiveAcquisitions(
            result.internetArchive,
          );
        const acquisition = acquisitions[0];

        if (!acquisition) {
          throw new Error(
            "This Internet Archive item does not expose a Reader-compatible downloadable file.",
          );
        }

        await startHttpAcquisition(acquisition.url, {
          title: result.internetArchive.title,
          authors: result.internetArchive.authors,
          acquisitionType: acquisition.format,
          catalogProviderId: "internet-archive",
          catalogSourceKey: result.internetArchive.identifier,
          catalogUrl:
            "https://archive.org/details/" +
            encodeURIComponent(result.internetArchive.identifier),
          catalogMetadata: {
            identifier: result.internetArchive.identifier,
            fileName: acquisition.name,
            format: acquisition.format,
            size: acquisition.size,
          },
        });

        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the Internet Archive result.",
        );
      } finally {
        setNetworkBusy(false);
      }
      return;
    }

    if (result.torrent) {
      setNetworkBusy(true);
      setMessage("");

      try {
        const input = result.torrent.result.input;
        const preview = await inspectTorrent(input);
        const selectedFile = preview.files.find(
          (file) => file.bookCandidate,
        );

        if (!selectedFile) {
          throw new Error(
            "The torrent result does not contain a Reader-compatible book file.",
          );
        }

        const preparation = await prepareTorrentAcquisition(
          input,
          preview,
          selectedFile,
        );
        await startPreparedTorrentAcquisition(preparation);
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the BitTorrent result.",
        );
      } finally {
        setNetworkBusy(false);
      }
      return;
    }

    if (result.s3) {
      const account = s3Accounts.find(
        (item) => item.id === result.s3?.accountId,
      );
      if (!account) {
        setMessage("The S3 account is no longer connected.");
        return;
      }

      setS3Busy(true);
      setMessage("");

      try {
        await startS3EntryAcquisition(
          account,
          result.s3.entry,
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the S3 result.",
        );
      } finally {
        setS3Busy(false);
      }
      return;
    }

    if (result.sftp) {
      const account = sftpAccounts.find(
        (item) => item.id === result.sftp?.accountId,
      );
      if (!account) {
        setMessage("The SFTP account is no longer connected.");
        return;
      }

      setSftpBusy(true);
      setMessage("");

      try {
        await startSftpEntryAcquisition(
          account,
          result.sftp.entry,
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the SFTP result.",
        );
      } finally {
        setSftpBusy(false);
      }
      return;
    }

    if (result.ed2k) {
      const engine = ed2kEngines.find(
        (item) => item.id === result.ed2k?.accountId,
      );
      if (!engine) {
        setMessage("The aMule ED2K engine is no longer configured.");
        return;
      }

      setEd2kBusy(true);
      setMessage("");

      try {
        await startEd2kSearchResultAcquisition(
          engine,
          result.ed2k.query,
          result.ed2k.result,
        );
        setTab("downloads");
        await refreshResourceCore();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to acquire the ED2K result.",
        );
      } finally {
        setEd2kBusy(false);
      }
    }
  }

  function inspectInput() {
    const next = classifyResourceInput(input);
    setClassification(next);
    setHttpPreparation(null);
    setTorrentPreview(null);
    setEd2kLinkMetadata(
      next.kind === "ed2k"
        ? (() => {
            try {
              return parseEd2kLink(next.normalizedInput);
            } catch {
              return null;
            }
          })()
        : null,
    );
    setTorrentSelectedFileIndex(null);
    setMessage(
      "Classification only — no network request was sent.",
    );
  }

  async function previewCurrentTorrent() {
    if (
      !classification ||
      (classification.kind !== "magnet" &&
        classification.kind !== "torrent")
    ) {
      return;
    }

    setNetworkBusy(true);
    setMessage("");

    try {
      const preview = await inspectTorrent(
        classification.normalizedInput,
      );
      setTorrentPreview(preview);

      const firstBook = preview.files.find(
        (file) => file.bookCandidate,
      );
      setTorrentSelectedFileIndex(firstBook?.index ?? null);
      setMessage(
        "Torrent metadata resolved. No book file has been downloaded yet.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to resolve torrent metadata.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function downloadSelectedTorrentFile() {
    if (
      !classification ||
      !torrentPreview ||
      torrentSelectedFileIndex === null
    ) {
      return;
    }

    const selectedFile = torrentPreview.files.find(
      (file) => file.index === torrentSelectedFileIndex,
    );
    if (!selectedFile) return;

    setNetworkBusy(true);
    setMessage("");

    try {
      const preparation = await prepareTorrentAcquisition(
        classification.normalizedInput,
        torrentPreview,
        selectedFile,
      );
      await startPreparedTorrentAcquisition(preparation);
      setMessage(
        "BitTorrent download started. It continues outside the Resources page.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to start BitTorrent download.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function probeCurrentCloudShare() {
    if (
      !classification ||
      !isSupportedCloudShareKind(classification.kind)
    ) {
      return;
    }

    setNetworkBusy(true);
    setMessage("");

    try {
      const preparation = await prepareCloudShareAcquisition(
        classification.kind,
        classification.normalizedInput,
      );
      setHttpPreparation(preparation);
      setMessage(
        "Cloud share resolved. No file has been downloaded yet.",
      );
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to resolve the cloud share link.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function probeCurrentHttp() {
    if (!classification || classification.kind !== "http") return;

    setNetworkBusy(true);
    setMessage("");

    try {
      const preparation = await prepareHttpAcquisition(
        classification.normalizedInput,
      );
      setHttpPreparation(preparation);
      setMessage(
        "HTTP metadata loaded. No file has been downloaded yet.",
      );
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to probe the HTTP resource.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function downloadPreparedHttp() {
    if (!httpPreparation) return;

    setNetworkBusy(true);
    setMessage("");

    try {
      await startPreparedHttpAcquisition(
        httpPreparation,
        classification?.normalizedInput,
      );
      setMessage(
        "HTTP download started. It will continue if you leave Resources.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to start the HTTP download.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function saveDraft() {
    if (
      !classification ||
      !classification.providerHint ||
      classification.kind === "unknown"
    ) {
      return;
    }

    setSavingDraft(true);
    setMessage("");

    try {
      const created = await createDraftTransferJob({
        providerId: classification.providerHint,
        transportType: classification.kind,
        resumeData: {
          resourceInput: classification.normalizedInput,
          classification,
        },
      });

      if (!created) {
        setMessage(
          "Draft persistence is available in the desktop app.",
        );
        return;
      }

      setTransfers((jobs) => [created, ...jobs]);
      setMessage(
        "Saved as a draft transfer job. No network activity was started.",
      );
      setTab("downloads");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the draft transfer job.",
      );
    } finally {
      setSavingDraft(false);
    }
  }

  async function saveAndOpenCatalog(
    name: string,
    url: string,
  ) {
    setOpdsBusy(true);
    setMessage("");

    try {
      const feed = await fetchOpdsCatalog(url);
      const catalog = await saveResourceCatalog(
        name.trim() || feed.title,
        feed.url,
        {
          feedTitle: feed.title,
          searchUrl: feed.searchUrl,
        },
      );

      if (!catalog) {
        throw new Error(
          "OPDS catalogs can be saved in the desktop application.",
        );
      }

      setActiveCatalog(catalog);
      setOpdsFeed(feed);
      setCatalogName("");
      setCatalogUrl("");
      await refreshResourceCore();
      setTab("browse");
      setMessage(
        "OPDS catalog loaded. Browsing does not start a download.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the OPDS catalog.",
      );
    } finally {
      setOpdsBusy(false);
    }
  }

  async function openCatalog(catalog: ResourceCatalog) {
    setOpdsBusy(true);
    setMessage("");

    try {
      const feed = await fetchOpdsCatalog(catalog.url);
      setActiveCatalog(catalog);
      setOpdsFeed(feed);
      setOpdsQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open the OPDS catalog.",
      );
    } finally {
      setOpdsBusy(false);
    }
  }

  async function searchCatalog() {
    if (!activeCatalog || !opdsQuery.trim()) return;

    setOpdsBusy(true);
    setMessage("");

    try {
      const feed = await searchOpdsCatalog(
        activeCatalog.url,
        opdsQuery,
      );
      setOpdsFeed(feed);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to search the OPDS catalog.",
      );
    } finally {
      setOpdsBusy(false);
    }
  }

  async function openOpdsSection(link: OpdsLink) {
    setOpdsBusy(true);
    setMessage("");

    try {
      const feed = await fetchOpdsCatalog(link.href);
      setOpdsFeed(feed);
      setOpdsQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open the OPDS section.",
      );
    } finally {
      setOpdsBusy(false);
    }
  }

  async function acquireOpdsEntry(
    entry: OpdsEntry,
    link: OpdsLink,
  ) {
    setNetworkBusy(true);
    setMessage("");

    try {
      await startHttpAcquisition(link.href, {
        title: entry.title,
        authors: entry.authors,
        opdsCatalogUrl: activeCatalog?.url ?? opdsFeed?.url,
        opdsEntryId: entry.id,
        acquisitionType: link.type,
      });
      setMessage(
        "Download started from the OPDS acquisition link.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to acquire the OPDS resource.",
      );
    } finally {
      setNetworkBusy(false);
    }
  }

  async function removeCatalog(catalog: ResourceCatalog) {
    await removeResourceCatalog(catalog.id);
    if (activeCatalog?.id === catalog.id) {
      setActiveCatalog(null);
      setOpdsFeed(null);
      setOpdsQuery("");
    }
    await refreshResourceCore();
  }

  function activeCloudAccount(): ConnectedCloudAccount | null {
    return (
      cloudAccounts.find(
        (account) => account.id === activeCloudAccountId,
      ) ?? null
    );
  }

  async function connectCloud() {
    if (
      !connectToken.trim() &&
      !(connectRefreshToken.trim() && connectClientId.trim())
    ) {
      return;
    }

    setCloudBusy(true);
    setMessage("");

    try {
      const account = await connectCloudAccount(
        connectProvider,
        connectDisplayName,
        connectToken,
        {
          refreshToken: connectRefreshToken || undefined,
          clientId: connectClientId || undefined,
          clientSecret: connectClientSecret || undefined,
          tenant:
            connectProvider === "onedrive"
              ? connectTenant || "common"
              : undefined,
        },
      );
      setConnectToken("");
      setConnectRefreshToken("");
      setConnectClientSecret("");
      setConnectDisplayName("");
      await refreshResourceCore();
      setActiveCloudAccountId(account.id);

      const result = await browseCloudAccount(account);
      setCloudEntries(result.entries);
      setCloudFolder(undefined);
      setCloudFolderStack([{ label: "Root" }]);
      setCloudQuery("");
      setTab("browse");
      setMessage(
        account.displayName +
          " connected. OAuth credentials are stored in the native secure credential store.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect the cloud account.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function disconnectCloud(account: ConnectedCloudAccount) {
    setCloudBusy(true);
    setMessage("");

    try {
      await disconnectCloudAccount(account);
      if (activeCloudAccountId === account.id) {
        setActiveCloudAccountId(null);
        setCloudEntries([]);
        setCloudFolder(undefined);
        setCloudFolderStack([{ label: "Root" }]);
      }
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect the cloud account.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function openCloudRoot(
    account: ConnectedCloudAccount,
  ) {
    setCloudBusy(true);
    setMessage("");

    try {
      const result = await browseCloudAccount(account);
      setActiveCloudAccountId(account.id);
      setCloudEntries(result.entries);
      setCloudFolder(undefined);
      setCloudFolderStack([{ label: "Root" }]);
      setCloudQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to browse the cloud account.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function openCloudFolder(entry: CloudEntry) {
    const account = activeCloudAccount();
    if (!account || !entry.isFolder) return;

    const locator = cloudFolderLocator(
      account.providerId,
      entry,
    );

    setCloudBusy(true);
    setMessage("");

    try {
      const result = await browseCloudAccount(
        account,
        locator,
      );
      setCloudEntries(result.entries);
      setCloudFolder(locator);
      setCloudFolderStack((current) => [
        ...current,
        { label: entry.name, locator },
      ]);
      setCloudQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open the cloud folder.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function goToCloudFolder(index: number) {
    const account = activeCloudAccount();
    if (!account) return;

    const target = cloudFolderStack[index];
    if (!target) return;

    setCloudBusy(true);
    setMessage("");

    try {
      const result = await browseCloudAccount(
        account,
        target.locator,
      );
      setCloudEntries(result.entries);
      setCloudFolder(target.locator);
      setCloudFolderStack((current) =>
        current.slice(0, index + 1),
      );
      setCloudQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to return to the cloud folder.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function searchCloud() {
    const account = activeCloudAccount();
    if (!account || !cloudQuery.trim()) return;

    setCloudBusy(true);
    setMessage("");

    try {
      const result = await searchCloudAccount(
        account,
        cloudQuery,
        cloudFolder,
      );
      setCloudEntries(result.entries);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to search cloud storage.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function acquireCloudEntry(entry: CloudEntry) {
    const account = activeCloudAccount();
    if (!account || !cloudEntryIsBook(entry)) return;

    setCloudBusy(true);
    setMessage("");

    try {
      await startCloudEntryAcquisition(account, entry);
      setMessage(
        "Cloud download started. It continues if you leave Resources.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to download the cloud file.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  function activeWebDavAccount(): ConnectedWebDavAccount | null {
    return (
      webDavAccounts.find(
        (account) => account.id === activeWebDavAccountId,
      ) ?? null
    );
  }

  async function connectWebDav() {
    if (!webDavBaseUrl.trim()) return;

    setWebDavBusy(true);
    setMessage("");

    try {
      const account = await connectWebDavAccount({
        displayName: webDavDisplayName,
        baseUrl: webDavBaseUrl,
        username: webDavUsername,
        password: webDavPassword,
      });

      setWebDavPassword("");
      setActiveWebDavAccountId(account.id);
      await refreshResourceCore();
      await openWebDavRoot(account);
      setTab("browse");
      setMessage("WebDAV / Nextcloud account connected.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect the WebDAV account.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function disconnectWebDav(account: ConnectedWebDavAccount) {
    setWebDavBusy(true);
    setMessage("");

    try {
      await disconnectWebDavAccount(account);
      if (activeWebDavAccountId === account.id) {
        setActiveWebDavAccountId(null);
        setWebDavEntries([]);
        setWebDavPath(undefined);
        setWebDavFolderStack([{ label: "Root" }]);
      }
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect WebDAV.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function openWebDavRoot(
    account: ConnectedWebDavAccount,
  ) {
    setWebDavBusy(true);
    setMessage("");

    try {
      const result = await browseWebDavAccount(account);
      setActiveWebDavAccountId(account.id);
      setWebDavEntries(result.entries);
      setWebDavPath(result.path);
      setWebDavFolderStack([{ label: "Root", locator: result.path }]);
      setWebDavQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to browse WebDAV.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function openWebDavFolder(entry: WebDavEntry) {
    const account = activeWebDavAccount();
    if (!account || !entry.isFolder) return;

    setWebDavBusy(true);
    setMessage("");

    try {
      const result = await browseWebDavAccount(
        account,
        entry.href,
      );
      setWebDavEntries(result.entries);
      setWebDavPath(result.path);
      setWebDavFolderStack((current) => [
        ...current,
        { label: entry.name, locator: result.path },
      ]);
      setWebDavQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open WebDAV folder.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function goToWebDavFolder(index: number) {
    const account = activeWebDavAccount();
    const target = webDavFolderStack[index];
    if (!account || !target) return;

    setWebDavBusy(true);
    setMessage("");

    try {
      const result = await browseWebDavAccount(
        account,
        target.locator,
      );
      setWebDavEntries(result.entries);
      setWebDavPath(result.path);
      setWebDavFolderStack((current) =>
        current.slice(0, index + 1),
      );
      setWebDavQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to return to WebDAV folder.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function searchWebDav() {
    const account = activeWebDavAccount();
    if (!account || !webDavQuery.trim()) return;

    setWebDavBusy(true);
    setMessage("");

    try {
      const result = await searchWebDavAccount(
        account,
        webDavQuery,
        webDavPath,
      );
      setWebDavEntries(result.entries);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to search WebDAV.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  async function acquireWebDavEntry(entry: WebDavEntry) {
    const account = activeWebDavAccount();
    if (!account || !webDavEntryIsBook(entry)) return;

    setWebDavBusy(true);
    setMessage("");

    try {
      await startWebDavEntryAcquisition(account, entry);
      setTab("downloads");
      setMessage(
        "WebDAV download started. It continues if you leave Resources.",
      );
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to download the WebDAV file.",
      );
    } finally {
      setWebDavBusy(false);
    }
  }

  function activeS3Account(): ConnectedS3Account | null {
    return (
      s3Accounts.find(
        (account) => account.id === activeS3AccountId,
      ) ?? null
    );
  }

  async function connectS3() {
    if (
      !s3Endpoint.trim() ||
      !s3Region.trim() ||
      !s3Bucket.trim() ||
      !s3AccessKey.trim() ||
      !s3SecretKey
    ) {
      return;
    }

    setS3Busy(true);
    setMessage("");

    try {
      const account = await connectS3Account({
        displayName: s3DisplayName,
        endpoint: s3Endpoint,
        region: s3Region,
        bucket: s3Bucket,
        prefix: s3RootPrefix,
        accessKey: s3AccessKey,
        secretKey: s3SecretKey,
        sessionToken: s3SessionToken || undefined,
      });

      setS3SecretKey("");
      setS3SessionToken("");
      setActiveS3AccountId(account.id);
      await refreshResourceCore();
      await openS3Root(account);
      setTab("browse");
      setMessage("S3-compatible storage connected.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect S3-compatible storage.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function disconnectS3(account: ConnectedS3Account) {
    setS3Busy(true);
    setMessage("");

    try {
      await disconnectS3Account(account);
      if (activeS3AccountId === account.id) {
        setActiveS3AccountId(null);
        setS3Entries([]);
        setS3Prefix(undefined);
        setS3FolderStack([{ label: "Root" }]);
      }
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect S3 storage.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function openS3Root(account: ConnectedS3Account) {
    setS3Busy(true);
    setMessage("");

    try {
      const result = await browseS3Account(account);
      const prefix =
        typeof account.metadata.prefix === "string" &&
        account.metadata.prefix
          ? account.metadata.prefix
          : result.prefix || undefined;
      setActiveS3AccountId(account.id);
      setS3Entries(result.entries);
      setS3Prefix(prefix);
      setS3FolderStack([{ label: "Root", prefix }]);
      setS3Query("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to browse S3 storage.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function openS3Folder(entry: S3Entry) {
    const account = activeS3Account();
    if (!account || !entry.isFolder) return;

    setS3Busy(true);
    setMessage("");

    try {
      const result = await browseS3Account(
        account,
        entry.key,
      );
      setS3Entries(result.entries);
      setS3Prefix(result.prefix);
      setS3FolderStack((current) => [
        ...current,
        { label: entry.name, prefix: result.prefix },
      ]);
      setS3Query("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open S3 prefix.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function goToS3Folder(index: number) {
    const account = activeS3Account();
    const target = s3FolderStack[index];
    if (!account || !target) return;

    setS3Busy(true);
    setMessage("");

    try {
      const result = await browseS3Account(
        account,
        target.prefix,
      );
      setS3Entries(result.entries);
      setS3Prefix(result.prefix);
      setS3FolderStack((current) =>
        current.slice(0, index + 1),
      );
      setS3Query("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to return to the S3 prefix.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function searchS3() {
    const account = activeS3Account();
    if (!account || !s3Query.trim()) return;

    setS3Busy(true);
    setMessage("");

    try {
      const result = await searchS3Account(
        account,
        s3Query,
        s3Prefix,
      );
      setS3Entries(result.entries);
      if (result.truncated) {
        setMessage(
          "S3 search reached the 5,000-object inspection limit. Narrow the prefix or query for more precise results.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to search S3 storage.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  async function acquireS3Entry(entry: S3Entry) {
    const account = activeS3Account();
    if (!account || !s3EntryIsBook(entry)) return;

    setS3Busy(true);
    setMessage("");

    try {
      await startS3EntryAcquisition(account, entry);
      setTab("downloads");
      setMessage(
        "S3 download started. It continues if you leave Resources.",
      );
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to download the S3 object.",
      );
    } finally {
      setS3Busy(false);
    }
  }

  function activeSftpAccount(): ConnectedSftpAccount | null {
    return (
      sftpAccounts.find(
        (account) => account.id === activeSftpAccountId,
      ) ?? null
    );
  }

  async function connectSftp() {
    const port = Number(sftpPort);
    if (
      !sftpHost.trim() ||
      !sftpUsername.trim() ||
      !Number.isFinite(port)
    ) {
      return;
    }

    setSftpBusy(true);
    setMessage("");

    try {
      const account = await connectSftpAccount({
        displayName: sftpDisplayName,
        host: sftpHost,
        port,
        username: sftpUsername,
        password: sftpPassword || undefined,
        privateKeyPath: sftpPrivateKeyPath || undefined,
        privateKeyPassphrase:
          sftpPrivateKeyPassphrase || undefined,
        rootPath: sftpRootPath,
      });

      setSftpPassword("");
      setSftpPrivateKeyPassphrase("");
      setActiveSftpAccountId(account.id);
      await refreshResourceCore();
      await openSftpRoot(account);
      setTab("browse");
      setMessage("SFTP storage connected.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect SFTP storage.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function disconnectSftp(account: ConnectedSftpAccount) {
    setSftpBusy(true);
    setMessage("");

    try {
      await disconnectSftpAccount(account);
      if (activeSftpAccountId === account.id) {
        setActiveSftpAccountId(null);
        setSftpEntries([]);
        setSftpPath(undefined);
        setSftpFolderStack([{ label: "Root" }]);
      }
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect SFTP.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function openSftpRoot(account: ConnectedSftpAccount) {
    setSftpBusy(true);
    setMessage("");

    try {
      const result = await browseSftpAccount(account);
      setActiveSftpAccountId(account.id);
      setSftpEntries(result.entries);
      setSftpPath(result.path);
      setSftpFolderStack([
        { label: "Root", path: result.path },
      ]);
      setSftpQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to browse SFTP storage.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function openSftpFolder(entry: SftpEntry) {
    const account = activeSftpAccount();
    if (!account || !entry.isFolder) return;

    setSftpBusy(true);
    setMessage("");

    try {
      const result = await browseSftpAccount(
        account,
        entry.path,
      );
      setSftpEntries(result.entries);
      setSftpPath(result.path);
      setSftpFolderStack((current) => [
        ...current,
        { label: entry.name, path: result.path },
      ]);
      setSftpQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open SFTP folder.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function goToSftpFolder(index: number) {
    const account = activeSftpAccount();
    const target = sftpFolderStack[index];
    if (!account || !target) return;

    setSftpBusy(true);
    setMessage("");

    try {
      const result = await browseSftpAccount(
        account,
        target.path,
      );
      setSftpEntries(result.entries);
      setSftpPath(result.path);
      setSftpFolderStack((current) =>
        current.slice(0, index + 1),
      );
      setSftpQuery("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to return to the SFTP folder.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function searchSftp() {
    const account = activeSftpAccount();
    if (!account || !sftpQuery.trim()) return;

    setSftpBusy(true);
    setMessage("");

    try {
      const result = await searchSftpAccount(
        account,
        sftpQuery,
        sftpPath,
      );
      setSftpEntries(result.entries);
      if (result.truncated) {
        setMessage(
          "SFTP search reached the recursive folder limit. Narrow the root folder or query for more precise results.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to search SFTP storage.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  async function acquireSftpEntry(entry: SftpEntry) {
    const account = activeSftpAccount();
    if (!account || !sftpEntryIsBook(entry)) return;

    setSftpBusy(true);
    setMessage("");

    try {
      await startSftpEntryAcquisition(account, entry);
      setTab("downloads");
      setMessage(
        "SFTP download started. It continues if you leave Resources.",
      );
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to download the SFTP file.",
      );
    } finally {
      setSftpBusy(false);
    }
  }

  function activeEd2kEngine(): Ed2kEngineAccount | null {
    return (
      ed2kEngines.find(
        (engine) => engine.id === activeEd2kEngineId,
      ) ?? null
    );
  }

  async function connectEd2k() {
    if (!ed2kIncomingDir.trim()) return;

    const port = Number(ed2kPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setMessage("aMule EC port must be between 1 and 65535.");
      return;
    }

    setEd2kBusy(true);
    setMessage("");

    try {
      const engine = await connectEd2kEngine({
        executable: ed2kExecutable || undefined,
        host: ed2kHost || "127.0.0.1",
        port,
        password: ed2kPassword || undefined,
        incomingDir: ed2kIncomingDir,
      });

      setEd2kPassword("");
      setActiveEd2kEngineId(engine.id);
      await refreshResourceCore();
      setMessage("aMule ED2K engine connected.");
      setTab("browse");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to aMule.",
      );
    } finally {
      setEd2kBusy(false);
    }
  }

  async function disconnectEd2k(engine: Ed2kEngineAccount) {
    setEd2kBusy(true);
    setMessage("");

    try {
      await disconnectEd2kEngine(engine);
      if (activeEd2kEngineId === engine.id) {
        setActiveEd2kEngineId(null);
        setEd2kResults([]);
      }
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to remove the aMule connection.",
      );
    } finally {
      setEd2kBusy(false);
    }
  }

  async function runEd2kSearch() {
    const engine = activeEd2kEngine();
    if (!engine || !ed2kQuery.trim()) return;

    setEd2kBusy(true);
    setMessage("");

    try {
      const response = await searchEd2kEngine(
        engine,
        ed2kQuery,
        ed2kSearchType,
      );
      setEd2kResults(response.results);
      setMessage(
        response.results.length +
          " ED2K search result" +
          (response.results.length === 1 ? "" : "s") +
          " returned.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ED2K search failed.",
      );
    } finally {
      setEd2kBusy(false);
    }
  }

  async function acquireCurrentEd2kLink() {
    const engine = activeEd2kEngine();
    if (
      !engine ||
      !classification ||
      classification.kind !== "ed2k"
    ) {
      return;
    }

    setEd2kBusy(true);
    setMessage("");

    try {
      await startEd2kLinkAcquisition(
        engine,
        classification.normalizedInput,
      );
      setMessage(
        "ED2K link added to aMule. LexiPane will import the completed book from the configured Incoming directory.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to add the ED2K link.",
      );
    } finally {
      setEd2kBusy(false);
    }
  }

  async function acquireEd2kResult(result: Ed2kSearchResult) {
    const engine = activeEd2kEngine();
    if (!engine) return;

    setEd2kBusy(true);
    setMessage("");

    try {
      await startEd2kSearchResultAcquisition(
        engine,
        ed2kQuery,
        result,
      );
      setMessage(
        "ED2K search result queued in aMule. LexiPane will import it after completion.",
      );
      setTab("downloads");
      await refreshResourceCore();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to download the ED2K result.",
      );
    } finally {
      setEd2kBusy(false);
    }
  }

  async function handleTransferAction(
    job: TransferJob,
    action: "pause" | "resume" | "cancel" | "discard",
  ) {
    setMessage("");

    try {
      const torrent = job.providerId === "bittorrent";
      const cloud =
        job.providerId === "google-drive" ||
        job.providerId === "dropbox" ||
        job.providerId === "onedrive";
      const ed2k = job.providerId === "ed2k";
      const webdav = job.providerId === "webdav";
      const s3 = job.providerId === "s3";
      const sftp = job.providerId === "sftp";

      if (action === "pause") {
        if (torrent) {
          await pauseTorrentDownload(job.id);
        } else if (cloud) {
          await pauseCloudDownload(job.id);
        } else if (ed2k) {
          await pauseEd2kTransfer(job);
        } else if (webdav) {
          await pauseWebDavDownload(job.id);
        } else if (s3) {
          await pauseS3Download(job.id);
        } else if (sftp) {
          await pauseSftpDownload(job.id);
        } else {
          await pauseHttpDownload(job.id);
        }
      } else if (action === "cancel") {
        if (torrent) {
          await cancelTorrentDownload(job.id);
        } else if (cloud) {
          await cancelCloudDownload(job.id);
        } else if (ed2k) {
          await cancelEd2kTransfer(job);
        } else if (webdav) {
          await cancelWebDavDownload(job.id);
        } else if (s3) {
          await cancelS3Download(job.id);
        } else if (sftp) {
          await cancelSftpDownload(job.id);
        } else {
          await cancelHttpDownload(job.id);
        }
      } else if (action === "discard") {
        if (torrent) {
          await discardTorrentTransfer(job);
        } else if (cloud) {
          await discardCloudTransfer(job);
        } else if (ed2k) {
          await cancelEd2kTransfer(job);
        } else if (webdav) {
          await discardWebDavTransfer(job);
        } else if (s3) {
          await discardS3Transfer(job);
        } else if (sftp) {
          await discardSftpTransfer(job);
        } else {
          await discardHttpTransfer(job);
        }
        await refreshResourceCore();
      } else if (torrent) {
        await resumeTorrentTransfer(job);
      } else if (cloud) {
        await resumeCloudTransfer(job);
      } else if (ed2k) {
        await resumeEd2kTransfer(job);
      } else if (webdav) {
        await resumeWebDavTransfer(job);
      } else if (s3) {
        await resumeS3Transfer(job);
      } else if (sftp) {
        await resumeSftpTransfer(job);
      } else {
        await resumeHttpTransfer(job);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update the transfer.",
      );
    }
  }

  const canProbeHttp = classification?.kind === "http";
  const canProbeCloudShare =
    classification !== null &&
    isSupportedCloudShareKind(classification.kind);
  const canBrowseOpds = classification?.kind === "opds";
  const canPreviewTorrent =
    classification?.kind === "magnet" ||
    classification?.kind === "torrent";
  const canAcquireEd2k = classification?.kind === "ed2k";

  return (
    <div className="page resource-hub-page">
      <header className="page-header resource-hub-header">
        <div>
          <span className="eyebrow">Resource acquisition platform</span>
          <h1>Find it. Inspect it. Bring it into your library.</h1>
          <p>
            Search, inspect, download, and import reading resources from web,
            OPDS, cloud storage, and BitTorrent through one persistent pipeline.
          </p>
        </div>

        <div className="resource-core-status">
          <span className="resource-status-dot" />
          <div>
            <strong>
              {loading ? "Starting Resource Hub…" : "Resource Hub ready"}
            </strong>
            <small>
              LONGRUN-001 · {liveTransportCount} live transport(s)
            </small>
          </div>
        </div>
      </header>

      <div className="resource-tabs" role="tablist" aria-label="Resources">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "selected" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === "downloads" && transfers.length > 0 && (
              <span>{transfers.length}</span>
            )}
          </button>
        ))}
      </div>

      {message && <div className="resource-message">{message}</div>}

      {tab === "search" && (
        <>
          <section className="resource-section federated-search-section">
            <header>
              <div>
                <span className="eyebrow">Federated search</span>
                <h2>Search all connected reading sources</h2>
              </div>
              <small>
                Searches the local Library, public/open catalogs, saved OPDS
                and torrent catalogs, cloud accounts, WebDAV, S3, SFTP, and
                configured ED2K sources in one pass.
              </small>
            </header>

            <div className="federated-search-row">
              <input
                value={resourceQuery}
                placeholder="Search title, author, or keyword…"
                onChange={(event) =>
                  setResourceQuery(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void runFederatedSearch();
                  }
                }}
              />
              <button
                type="button"
                className="primary-button"
                disabled={
                  resourceSearchBusy || !resourceQuery.trim()
                }
                onClick={() => void runFederatedSearch()}
              >
                {resourceSearchBusy ? "Searching…" : "Search all"}
              </button>
              {resourceSearchBusy && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={cancelFederatedSearch}
                >
                  Cancel
                </button>
              )}
            </div>

            {(resourceSearchResults.length > 0 ||
              resourceSearchErrors.length > 0) && (
              <div className="federated-results">
                <div className="federated-results-heading">
                  <strong>
                    {resourceSearchResults.length} result
                    {resourceSearchResults.length === 1 ? "" : "s"}
                  </strong>
                  <small>
                    {resourceSearchSourceCount} source
                    {resourceSearchSourceCount === 1 ? "" : "s"} queried
                  </small>
                </div>

                <div className="federated-filter-row">
                  <label>
                    <span>Format</span>
                    <select
                      value={resourceFormatFilter}
                      onChange={(event) =>
                        setResourceFormatFilter(
                          event.target.value as
                            | "all"
                            | "pdf"
                            | "epub"
                            | "mobi"
                            | "azw"
                            | "azw3",
                        )
                      }
                    >
                      <option value="all">All formats</option>
                      <option value="pdf">PDF</option>
                      <option value="epub">EPUB</option>
                      <option value="mobi">MOBI</option>
                      <option value="azw">AZW</option>
                      <option value="azw3">AZW3</option>
                    </select>
                  </label>
                  <label>
                    <span>Source</span>
                    <select
                      value={resourceSourceFilter}
                      onChange={(event) =>
                        setResourceSourceFilter(
                          event.target.value as
                            | "all"
                            | "local"
                            | "storage"
                            | "public"
                            | "p2p",
                        )
                      }
                    >
                      <option value="all">All sources</option>
                      <option value="local">Local Library</option>
                      <option value="storage">Cloud / storage</option>
                      <option value="public">Public / open</option>
                      <option value="p2p">P2P</option>
                    </select>
                  </label>
                  <small>
                    Showing {visibleResourceSearchResults.length} of{" "}
                    {resourceSearchResults.length}
                  </small>
                </div>

                {resourceSearchSources.length > 0 && (
                  <details className="federated-source-status">
                    <summary>Source health & latency</summary>
                    <div>
                      {resourceSearchSources.map((source) => (
                        <span
                          key={source.id}
                          className={"status-" + source.status}
                          title={source.error}
                        >
                          <strong>{source.label}</strong>
                          {" · "}
                          {source.status === "ok" ? "OK" : "Error"}
                          {" · "}
                          {source.durationMs} ms
                          {" · "}
                          {source.resultCount} result
                          {source.resultCount === 1 ? "" : "s"}
                        </span>
                      ))}
                    </div>
                  </details>
                )}

                {visibleResourceSearchResults.map((result) => (
                  <article key={result.key}>
                    <div>
                      <span className="resource-kind-badge">
                        {result.providerId}
                      </span>
                      <strong>{result.title}</strong>
                      <small>
                        {result.authors.length
                          ? result.authors.join(", ") + " · "
                          : ""}
                        {result.sourceLabel}
                        {result.alternatives?.length
                          ? " · " +
                            (result.alternatives.length + 1) +
                            " sources"
                          : ""}
                        {result.size
                          ? " · " + formatBytes(result.size)
                          : ""}
                      </small>
                      {result.description && (
                        <p>{result.description}</p>
                      )}
                      {result.alternatives &&
                        result.alternatives.length > 0 && (
                          <details className="federated-alternatives">
                            <summary>
                              Other sources ({result.alternatives.length})
                            </summary>
                            <ul>
                              {result.alternatives.map((source) => (
                                <li key={source.key}>
                                  <span>
                                    {source.sourceLabel} · {source.providerId}
                                    {source.size
                                      ? " · " + formatBytes(source.size)
                                      : ""}
                                  </span>
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={
                                      networkBusy ||
                                      cloudBusy ||
                                      webDavBusy ||
                                      s3Busy ||
                                      sftpBusy ||
                                      ed2kBusy
                                    }
                                    onClick={() =>
                                      void acquireFederatedResult(
                                        alternativeAsResult(
                                          result,
                                          source,
                                        ),
                                      )
                                    }
                                  >
                                    Get
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                    </div>

                    {result.kind === "local" && result.localPath ? (
                      <button
                        type="button"
                        className="primary-button compact"
                        onClick={() =>
                          void onOpenBook(result.localPath!)
                        }
                      >
                        Open
                      </button>
                    ) : result.kind === "local" ? (
                      <span className="federated-local-badge">
                        Library
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="primary-button compact"
                        disabled={
                          networkBusy ||
                          cloudBusy ||
                          webDavBusy ||
                          s3Busy ||
                          sftpBusy ||
                          ed2kBusy
                        }
                        onClick={() =>
                          void acquireFederatedResult(result)
                        }
                      >
                        Get
                      </button>
                    )}
                  </article>
                ))}

                {resourceSearchErrors.length > 0 && (
                  <details className="federated-search-errors">
                    <summary>
                      {resourceSearchErrors.length} source error
                      {resourceSearchErrors.length === 1 ? "" : "s"}
                    </summary>
                    <ul>
                      {resourceSearchErrors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>

          <div className="resource-hub-grid">
          <section className="resource-main-card">
            <span className="eyebrow">Universal resource input</span>
            <h2>Paste a resource address</h2>
            <p>
              Inspect remains local-only. A separate action is required before
              LexiPane probes a web resource or opens an OPDS catalog.
            </p>

            <div className="resource-input-row">
              <input
                value={input}
                placeholder="Paste URL, magnet, ED2K link, share link, or catalog address…"
                onChange={(event) => {
                  setInput(event.target.value);
                  setClassification(null);
                  setHttpPreparation(null);
                  setMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") inspectInput();
                }}
              />
              <button
                className="primary-button"
                type="button"
                onClick={inspectInput}
              >
                Inspect
              </button>
            </div>

            {classification && (
              <div className="resource-classification">
                <div>
                  <span className="resource-kind-badge">
                    {classification.kind}
                  </span>
                  <h3>{classificationTitle(classification)}</h3>
                  <p>{classification.reason}</p>
                </div>

                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{classification.providerHint ?? "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{classification.confidence}</dd>
                  </div>
                  <div>
                    <dt>Inspect network</dt>
                    <dd>Not started</dd>
                  </div>
                </dl>

                <code>{classification.normalizedInput || "—"}</code>

                <div className="resource-classification-actions">
                  {canProbeHttp && (
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={networkBusy}
                      onClick={() => void probeCurrentHttp()}
                    >
                      {networkBusy ? "Probing…" : "Probe metadata"}
                    </button>
                  )}

                  {canProbeCloudShare && (
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={networkBusy}
                      onClick={() =>
                        void probeCurrentCloudShare()
                      }
                    >
                      {networkBusy ? "Resolving…" : "Resolve share"}
                    </button>
                  )}

                  {canBrowseOpds && (
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={opdsBusy}
                      onClick={() =>
                        void saveAndOpenCatalog(
                          "",
                          classification.normalizedInput,
                        )
                      }
                    >
                      {opdsBusy ? "Opening…" : "Browse catalog"}
                    </button>
                  )}

                  {canPreviewTorrent && (
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={networkBusy}
                      onClick={() => void previewCurrentTorrent()}
                    >
                      {networkBusy ? "Resolving…" : "Preview torrent"}
                    </button>
                  )}

                  {canAcquireEd2k && (
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={
                        ed2kBusy ||
                        ed2kEngines.length === 0 ||
                        !ed2kLinkMetadata?.bookCandidate
                      }
                      onClick={() => void acquireCurrentEd2kLink()}
                    >
                      {ed2kBusy ? "Adding…" : "Add ED2K book"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="ghost-button"
                    disabled={
                      savingDraft ||
                      !classification.providerHint ||
                      classification.kind === "unknown"
                    }
                    onClick={() => void saveDraft()}
                  >
                    {savingDraft ? "Saving…" : "Save as draft"}
                  </button>
                </div>

                {httpPreparation && (
                  <div className="resource-http-preview">
                    <div>
                      <span className="eyebrow">HTTP metadata</span>
                      <strong>
                        {httpPreparation.probe.fileName ??
                          httpPreparation.bundle.item.title}
                      </strong>
                      <small>{httpPreparation.probe.finalUrl}</small>
                    </div>

                    <dl>
                      <div>
                        <dt>Type</dt>
                        <dd>
                          {httpPreparation.probe.contentType ?? "Unknown"}
                        </dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>
                          {formatBytes(
                            httpPreparation.probe.contentLength,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Resume</dt>
                        <dd>
                          {httpPreparation.probe.acceptRanges
                            ? "Byte ranges"
                            : "Server dependent"}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      className="primary-button"
                      disabled={networkBusy}
                      onClick={() => void downloadPreparedHttp()}
                    >
                      Download and add to Library
                    </button>
                  </div>
                )}

                {torrentPreview && (
                  <div className="resource-http-preview torrent-preview-card">
                    <div>
                      <span className="eyebrow">BitTorrent metadata</span>
                      <strong>
                        {torrentPreview.name || "Resolved torrent"}
                      </strong>
                      <small>
                        {torrentPreview.infoHash} ·{" "}
                        {torrentPreview.seenPeers} peer
                        {torrentPreview.seenPeers === 1 ? "" : "s"} seen
                      </small>
                    </div>

                    <div className="torrent-file-list">
                      {torrentPreview.files.map((file) => (
                        <label
                          key={file.index}
                          className={
                            file.bookCandidate
                              ? "torrent-file-row book"
                              : "torrent-file-row"
                          }
                        >
                          <input
                            type="radio"
                            name="torrent-book-file"
                            value={file.index}
                            disabled={!file.bookCandidate}
                            checked={
                              torrentSelectedFileIndex === file.index
                            }
                            onChange={() =>
                              setTorrentSelectedFileIndex(file.index)
                            }
                          />
                          <span>
                            <strong>{file.name}</strong>
                            <small>
                              {formatBytes(file.length)}
                              {file.bookCandidate
                                ? " · Reader-compatible"
                                : ""}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        networkBusy ||
                        torrentSelectedFileIndex === null
                      }
                      onClick={() =>
                        void downloadSelectedTorrentFile()
                      }
                    >
                      Download selected book
                    </button>
                  </div>
                )}

                {canAcquireEd2k && ed2kLinkMetadata && (
                  <div className="resource-http-preview">
                    <div>
                      <span className="eyebrow">ED2K file link</span>
                      <strong>{ed2kLinkMetadata.name}</strong>
                      <small>{ed2kLinkMetadata.hash}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(ed2kLinkMetadata.size)}</dd>
                      </div>
                      <div>
                        <dt>Format</dt>
                        <dd>
                          {ed2kLinkMetadata.bookCandidate
                            ? "Reader-compatible"
                            : "Unsupported"}
                        </dd>
                      </div>
                      <div>
                        <dt>Engine</dt>
                        <dd>
                          {activeEd2kEngine()?.displayName ??
                            (ed2kEngines.length
                              ? "Configured"
                              : "Not configured")}
                        </dd>
                      </div>
                    </dl>
                    {ed2kEngines.length === 0 && (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setTab("accounts")}
                      >
                        Configure aMule
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="resource-summary-card">
            <span className="eyebrow">Resource inventory</span>
            <div className="resource-stat-grid">
              <div>
                <strong>{providers.length}</strong>
                <span>provider contracts</span>
              </div>
              <div>
                <strong>{resources.length}</strong>
                <span>persisted resources</span>
              </div>
              <div>
                <strong>{transfers.length}</strong>
                <span>transfer jobs</span>
              </div>
              <div>
                <strong>{catalogs.length}</strong>
                <span>OPDS catalogs</span>
              </div>
            </div>

            <div className="resource-safety-note">
              <strong>RESOURCE-002 boundary</strong>
              <p>
                HTTP, OPDS, connected cloud storage, WebDAV, BitTorrent, and
                ED2K are connected to the persistent acquisition pipeline.
              </p>
            </div>
          </aside>
        </div>
        </>
      )}

      {tab === "browse" && (
        <div className="resource-browse-stack">
          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">ED2K / Kad</span>
                <h2>Search through aMule</h2>
              </div>
              <small>
                LexiPane controls your configured aMule/aMuled instance through
                amulecmd and imports completed PDF/EPUB files from its Incoming
                directory.
              </small>
            </header>

            {ed2kEngines.length === 0 ? (
              <div className="resource-empty">
                <strong>aMule sidecar is not configured.</strong>
                <p>
                  Configure amulecmd, External Connections, and the Incoming
                  directory from Accounts.
                </p>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setTab("accounts")}
                >
                  Configure ED2K
                </button>
              </div>
            ) : (
              <>
                <div className="cloud-account-switcher">
                  {ed2kEngines.map((engine) => (
                    <button
                      key={engine.id}
                      type="button"
                      className={
                        activeEd2kEngineId === engine.id
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        setActiveEd2kEngineId(engine.id)
                      }
                    >
                      <strong>
                        {engine.displayName || "aMule ED2K"}
                      </strong>
                      <small>
                        {String(engine.metadata.host ?? "127.0.0.1")}:
                        {String(engine.metadata.port ?? 4712)}
                      </small>
                    </button>
                  ))}
                </div>

                <div className="ed2k-search-row">
                  <select
                    value={ed2kSearchType}
                    disabled={ed2kBusy}
                    onChange={(event) =>
                      setEd2kSearchType(
                        event.target.value as
                          | "global"
                          | "kad"
                          | "local",
                      )
                    }
                  >
                    <option value="global">Global</option>
                    <option value="kad">Kad</option>
                    <option value="local">Local</option>
                  </select>
                  <input
                    value={ed2kQuery}
                    placeholder="Search the ED2K network…"
                    onChange={(event) =>
                      setEd2kQuery(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runEd2kSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="primary-button compact"
                    disabled={ed2kBusy || !ed2kQuery.trim()}
                    onClick={() => void runEd2kSearch()}
                  >
                    {ed2kBusy ? "Searching…" : "Search"}
                  </button>
                </div>

                {ed2kResults.length > 0 && (
                  <div className="ed2k-results">
                    {ed2kResults.map((result) => (
                      <article key={result.index + ":" + result.name}>
                        <div>
                          <span className="resource-kind-badge">
                            #{result.index}
                          </span>
                          <strong>{result.name}</strong>
                          <small>
                            {formatBytes(result.size)}
                            {result.sources !== undefined
                              ? " · " + result.sources + " source(s)"
                              : ""}
                          </small>
                        </div>

                        <button
                          type="button"
                          className="primary-button compact"
                          disabled={
                            ed2kBusy || !result.bookCandidate
                          }
                          onClick={() =>
                            void acquireEd2kResult(result)
                          }
                        >
                          {result.bookCandidate
                            ? "Download"
                            : "Not a book"}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">Cloud storage</span>
                <h2>Google Drive, Dropbox & OneDrive</h2>
              </div>
              <small>
                Connected account tokens stay in the native secure credential
                store. Files are normalized into the same Resource Core and
                transfer pipeline.
              </small>
            </header>

            {cloudAccounts.length === 0 ? (
              <div className="resource-empty">
                <strong>No cloud accounts connected.</strong>
                <p>
                  Open Accounts to connect Google Drive, Dropbox, or OneDrive.
                </p>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setTab("accounts")}
                >
                  Connect account
                </button>
              </div>
            ) : (
              <>
                <div className="cloud-account-switcher">
                  {cloudAccounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={
                        activeCloudAccountId === account.id
                          ? "selected"
                          : ""
                      }
                      onClick={() => void openCloudRoot(account)}
                    >
                      <strong>
                        {account.displayName || account.providerId}
                      </strong>
                      <small>{account.providerId}</small>
                    </button>
                  ))}
                </div>

                {activeCloudAccount() && (
                  <div className="cloud-browser">
                    <div className="cloud-breadcrumbs">
                      {cloudFolderStack.map((item, index) => (
                        <button
                          key={index + ":" + (item.locator ?? "root")}
                          type="button"
                          disabled={
                            cloudBusy ||
                            index === cloudFolderStack.length - 1
                          }
                          onClick={() => void goToCloudFolder(index)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="opds-search-row">
                      <input
                        value={cloudQuery}
                        placeholder="Search this cloud account…"
                        onChange={(event) =>
                          setCloudQuery(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchCloud();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={cloudBusy || !cloudQuery.trim()}
                        onClick={() => void searchCloud()}
                      >
                        {cloudBusy ? "Working…" : "Search"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={cloudBusy}
                        onClick={() => {
                          const account = activeCloudAccount();
                          if (account) void openCloudRoot(account);
                        }}
                      >
                        Root
                      </button>
                    </div>

                    {cloudEntries.length === 0 ? (
                      <div className="resource-empty compact">
                        <strong>
                          {cloudBusy
                            ? "Loading cloud files…"
                            : "No files loaded."}
                        </strong>
                        {!cloudBusy && (
                          <p>
                            Select the account above to browse its root folder.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="cloud-entry-list">
                        {cloudEntries.map((entry) => (
                          <article key={entry.id}>
                            <div className="cloud-entry-icon">
                              {entry.isFolder ? "▣" : "▤"}
                            </div>
                            <div className="cloud-entry-main">
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.isFolder
                                  ? "Folder"
                                  : formatBytes(entry.size)}
                                {entry.mimeType
                                  ? " · " + entry.mimeType
                                  : ""}
                              </small>
                            </div>

                            {entry.isFolder ? (
                              <button
                                type="button"
                                className="ghost-button"
                                disabled={cloudBusy}
                                onClick={() =>
                                  void openCloudFolder(entry)
                                }
                              >
                                Open
                              </button>
                            ) : cloudEntryIsBook(entry) ? (
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={cloudBusy}
                                onClick={() =>
                                  void acquireCloudEntry(entry)
                                }
                              >
                                Download
                              </button>
                            ) : (
                              <small className="muted">
                                Not a Reader format
                              </small>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">S3-compatible storage</span>
                <h2>Browse object storage</h2>
              </div>
              <small>
                AWS S3, MinIO, Cloudflare R2, Backblaze B2 and compatible
                endpoints use the same verified download and Library pipeline.
              </small>
            </header>

            {s3Accounts.length === 0 ? (
              <div className="resource-empty">
                <strong>No S3-compatible account connected.</strong>
                <p>
                  Add an endpoint, bucket, region and credentials from Accounts.
                </p>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setTab("accounts")}
                >
                  Connect S3
                </button>
              </div>
            ) : (
              <>
                <div className="cloud-account-switcher">
                  {s3Accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={
                        activeS3AccountId === account.id
                          ? "selected"
                          : ""
                      }
                      onClick={() => void openS3Root(account)}
                    >
                      <strong>{account.displayName || "S3"}</strong>
                      <small>
                        {String(account.metadata.bucket ?? "")}
                        {" · "}
                        {String(account.metadata.region ?? "")}
                      </small>
                    </button>
                  ))}
                </div>

                {activeS3Account() && (
                  <div className="cloud-browser">
                    <div className="cloud-breadcrumbs">
                      {s3FolderStack.map((item, index) => (
                        <button
                          key={index + ":" + (item.prefix ?? "root")}
                          type="button"
                          disabled={
                            s3Busy ||
                            index === s3FolderStack.length - 1
                          }
                          onClick={() => void goToS3Folder(index)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="opds-search-row">
                      <input
                        value={s3Query}
                        placeholder="Search objects under this prefix…"
                        onChange={(event) =>
                          setS3Query(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchS3();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={s3Busy || !s3Query.trim()}
                        onClick={() => void searchS3()}
                      >
                        {s3Busy ? "Working…" : "Search"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={s3Busy}
                        onClick={() => {
                          const account = activeS3Account();
                          if (account) void openS3Root(account);
                        }}
                      >
                        Root
                      </button>
                    </div>

                    {s3Entries.length === 0 ? (
                      <div className="resource-empty compact">
                        <strong>
                          {s3Busy ? "Loading objects…" : "No objects loaded."}
                        </strong>
                      </div>
                    ) : (
                      <div className="cloud-entry-list">
                        {s3Entries.map((entry) => (
                          <article key={entry.id}>
                            <div className="cloud-entry-icon">
                              {entry.isFolder ? "▣" : "▤"}
                            </div>
                            <div className="cloud-entry-main">
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.isFolder
                                  ? "Prefix"
                                  : formatBytes(entry.size)}
                                {entry.modifiedAt
                                  ? " · " + entry.modifiedAt
                                  : ""}
                              </small>
                            </div>

                            {entry.isFolder ? (
                              <button
                                type="button"
                                className="ghost-button"
                                disabled={s3Busy}
                                onClick={() =>
                                  void openS3Folder(entry)
                                }
                              >
                                Open
                              </button>
                            ) : s3EntryIsBook(entry) ? (
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={s3Busy}
                                onClick={() =>
                                  void acquireS3Entry(entry)
                                }
                              >
                                Download
                              </button>
                            ) : (
                              <small className="muted">
                                Not a Reader format
                              </small>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">SFTP storage</span>
                <h2>Browse SSH file servers</h2>
              </div>
              <small>
                Password or private-key authenticated SFTP folders feed the
                same persistent download and verified Library pipeline.
              </small>
            </header>

            {sftpAccounts.length === 0 ? (
              <div className="resource-empty">
                <strong>No SFTP account connected.</strong>
                <p>
                  Add an SFTP server from Accounts, then browse or search its
                  configured root folder here.
                </p>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setTab("accounts")}
                >
                  Connect SFTP
                </button>
              </div>
            ) : (
              <>
                <div className="cloud-account-switcher">
                  {sftpAccounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={
                        activeSftpAccountId === account.id
                          ? "selected"
                          : ""
                      }
                      onClick={() => void openSftpRoot(account)}
                    >
                      <strong>{account.displayName || "SFTP"}</strong>
                      <small>
                        {String(account.metadata.username ?? "")}
                        {"@"}
                        {String(account.metadata.host ?? "")}
                        {":"}
                        {String(account.metadata.port ?? 22)}
                      </small>
                    </button>
                  ))}
                </div>

                {activeSftpAccount() && (
                  <div className="cloud-browser">
                    <div className="cloud-breadcrumbs">
                      {sftpFolderStack.map((item, index) => (
                        <button
                          key={index + ":" + (item.path ?? "root")}
                          type="button"
                          disabled={
                            sftpBusy ||
                            index === sftpFolderStack.length - 1
                          }
                          onClick={() => void goToSftpFolder(index)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="opds-search-row">
                      <input
                        value={sftpQuery}
                        placeholder="Search SFTP folders…"
                        onChange={(event) =>
                          setSftpQuery(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchSftp();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={sftpBusy || !sftpQuery.trim()}
                        onClick={() => void searchSftp()}
                      >
                        {sftpBusy ? "Working…" : "Search"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={sftpBusy}
                        onClick={() => {
                          const account = activeSftpAccount();
                          if (account) void openSftpRoot(account);
                        }}
                      >
                        Root
                      </button>
                    </div>

                    {sftpEntries.length === 0 ? (
                      <div className="resource-empty compact">
                        <strong>
                          {sftpBusy
                            ? "Loading SFTP…"
                            : "No files loaded."}
                        </strong>
                      </div>
                    ) : (
                      <div className="cloud-entry-list">
                        {sftpEntries.map((entry) => (
                          <article key={entry.id}>
                            <div className="cloud-entry-icon">
                              {entry.isFolder ? "▣" : "▤"}
                            </div>
                            <div className="cloud-entry-main">
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.isFolder
                                  ? "Folder"
                                  : formatBytes(entry.size)}
                                {entry.modifiedAt
                                  ? " · modified " +
                                    new Date(
                                      entry.modifiedAt * 1000,
                                    ).toLocaleString()
                                  : ""}
                              </small>
                            </div>

                            {entry.isFolder ? (
                              <button
                                type="button"
                                className="ghost-button"
                                disabled={sftpBusy}
                                onClick={() =>
                                  void openSftpFolder(entry)
                                }
                              >
                                Open
                              </button>
                            ) : sftpEntryIsBook(entry) ? (
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={sftpBusy}
                                onClick={() =>
                                  void acquireSftpEntry(entry)
                                }
                              >
                                Download
                              </button>
                            ) : (
                              <small className="muted">
                                Not a Reader format
                              </small>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">WebDAV / Nextcloud</span>
                <h2>Browse self-hosted and NAS storage</h2>
              </div>
              <small>
                Standard WebDAV PROPFIND browsing with Reader-compatible acquisition
                through the same persistent download and Library pipeline.
              </small>
            </header>

            {webDavAccounts.length === 0 ? (
              <div className="resource-empty">
                <strong>No WebDAV account connected.</strong>
                <p>
                  Add a WebDAV or Nextcloud endpoint from Accounts.
                </p>
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => setTab("accounts")}
                >
                  Connect WebDAV
                </button>
              </div>
            ) : (
              <>
                <div className="cloud-account-switcher">
                  {webDavAccounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={
                        activeWebDavAccountId === account.id
                          ? "selected"
                          : ""
                      }
                      onClick={() => void openWebDavRoot(account)}
                    >
                      <strong>
                        {account.displayName || "WebDAV"}
                      </strong>
                      <small>
                        {String(account.metadata.baseUrl ?? "")}
                      </small>
                    </button>
                  ))}
                </div>

                {activeWebDavAccount() && (
                  <div className="cloud-browser">
                    <div className="cloud-breadcrumbs">
                      {webDavFolderStack.map((item, index) => (
                        <button
                          key={index + ":" + (item.locator ?? "root")}
                          type="button"
                          disabled={
                            webDavBusy ||
                            index === webDavFolderStack.length - 1
                          }
                          onClick={() => void goToWebDavFolder(index)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="opds-search-row">
                      <input
                        value={webDavQuery}
                        placeholder="Search WebDAV folders…"
                        onChange={(event) =>
                          setWebDavQuery(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void searchWebDav();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={webDavBusy || !webDavQuery.trim()}
                        onClick={() => void searchWebDav()}
                      >
                        {webDavBusy ? "Working…" : "Search"}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={webDavBusy}
                        onClick={() => {
                          const account = activeWebDavAccount();
                          if (account) void openWebDavRoot(account);
                        }}
                      >
                        Root
                      </button>
                    </div>

                    {webDavEntries.length === 0 ? (
                      <div className="resource-empty compact">
                        <strong>
                          {webDavBusy
                            ? "Loading WebDAV…"
                            : "No files loaded."}
                        </strong>
                      </div>
                    ) : (
                      <div className="cloud-entry-list">
                        {webDavEntries.map((entry) => (
                          <article key={entry.id}>
                            <div className="cloud-entry-icon">
                              {entry.isFolder ? "▣" : "▤"}
                            </div>
                            <div className="cloud-entry-main">
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.isFolder
                                  ? "Folder"
                                  : formatBytes(entry.size)}
                                {entry.mimeType
                                  ? " · " + entry.mimeType
                                  : ""}
                              </small>
                            </div>

                            {entry.isFolder ? (
                              <button
                                type="button"
                                className="ghost-button"
                                disabled={webDavBusy}
                                onClick={() =>
                                  void openWebDavFolder(entry)
                                }
                              >
                                Open
                              </button>
                            ) : webDavEntryIsBook(entry) ? (
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={webDavBusy}
                                onClick={() =>
                                  void acquireWebDavEntry(entry)
                                }
                              >
                                Download
                              </button>
                            ) : (
                              <small className="muted">
                                Not a Reader format
                              </small>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">OPDS catalogs</span>
                <h2>Browse open or authorized book catalogs</h2>
              </div>
              <small>
                Catalog discovery is separate from acquisition. A book is only
                downloaded after you choose an acquisition link.
              </small>
            </header>

            <div className="opds-add-row">
              <input
                value={catalogName}
                placeholder="Catalog name (optional)"
                onChange={(event) => setCatalogName(event.target.value)}
              />
              <input
                value={catalogUrl}
                placeholder="https://example.org/opds"
                onChange={(event) => setCatalogUrl(event.target.value)}
              />
              <button
                className="primary-button compact"
                type="button"
                disabled={opdsBusy || !catalogUrl.trim()}
                onClick={() =>
                  void saveAndOpenCatalog(catalogName, catalogUrl)
                }
              >
                {opdsBusy ? "Loading…" : "Add & open"}
              </button>
            </div>

            {catalogs.length > 0 && (
              <div className="opds-catalog-list">
                {catalogs.map((catalog) => (
                  <div
                    key={catalog.id}
                    className={
                      activeCatalog?.id === catalog.id ? "active" : ""
                    }
                  >
                    <button
                      type="button"
                      onClick={() => void openCatalog(catalog)}
                    >
                      <strong>{catalog.name}</strong>
                      <small>{catalog.url}</small>
                    </button>
                    <button
                      type="button"
                      aria-label={"Remove " + catalog.name}
                      onClick={() => void removeCatalog(catalog)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeCatalog && (
              <div className="opds-search-row">
                <input
                  value={opdsQuery}
                  placeholder={"Search " + activeCatalog.name}
                  onChange={(event) => setOpdsQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void searchCatalog();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ghost-button"
                  disabled={opdsBusy || !opdsQuery.trim()}
                  onClick={() => void searchCatalog()}
                >
                  Search
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={opdsBusy}
                  onClick={() => void openCatalog(activeCatalog)}
                >
                  Root
                </button>
              </div>
            )}

            {opdsFeed && (
              <div className="opds-feed">
                <div className="opds-feed-heading">
                  <div>
                    <span className="eyebrow">Current feed</span>
                    <h3>{opdsFeed.title}</h3>
                  </div>
                  <small>
                    {opdsFeed.entries.length} item
                    {opdsFeed.entries.length === 1 ? "" : "s"}
                  </small>
                </div>

                <div className="opds-entry-grid">
                  {opdsFeed.entries.map((entry) => (
                    <article key={entry.id} className="opds-entry-card">
                      {entry.coverUrl ? (
                        <img
                          src={entry.coverUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="opds-cover-placeholder">Book</div>
                      )}

                      <div>
                        <h4>{entry.title}</h4>
                        {entry.authors.length > 0 && (
                          <small>{entry.authors.join(", ")}</small>
                        )}
                        {entry.summary && <p>{entry.summary}</p>}

                        {(entry.acquisitions.length > 0 ||
                          entry.navigation.length > 0) ? (
                          <div className="opds-acquisition-actions">
                            {entry.navigation.map((link) => (
                              <button
                                key={"nav-" + link.href + link.rel}
                                type="button"
                                className="ghost-button"
                                disabled={opdsBusy}
                                onClick={() =>
                                  void openOpdsSection(link)
                                }
                              >
                                {link.title || "Open section"} →
                              </button>
                            ))}
                            {entry.acquisitions.map((link) => (
                              <button
                                key={link.href + link.rel}
                                type="button"
                                className="ghost-button"
                                disabled={networkBusy}
                                onClick={() =>
                                  void acquireOpdsEntry(entry, link)
                                }
                              >
                                {opdsLinkLabel(link)}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <small>No catalog or PDF/EPUB link.</small>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="resource-section">
            <header>
              <div>
                <span className="eyebrow">Provider registry</span>
                <h2>Available contracts</h2>
              </div>
              <small>
                Live means an implementation exists and is wired to Resource
                Hub. Provider-specific credentials or engines may still be
                required.
              </small>
            </header>

            <div className="resource-provider-grid">
              {providers.map((provider) => (
                <article className="resource-provider-card" key={provider.id}>
                  <div className="resource-provider-heading">
                    <div>
                      <span>{provider.kind}</span>
                      <h3>{provider.name}</h3>
                    </div>
                    <em className={provider.live ? "live" : ""}>
                      {provider.live ? "Live" : "Contract only"}
                    </em>
                  </div>

                  <div className="resource-capabilities">
                    {capabilityLabels(provider.capabilities).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>

                  <small>
                    {provider.enabled ? "Enabled contract" : "Disabled"}
                    {provider.builtin ? " · Built in" : " · Custom"}
                  </small>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "downloads" && (
        <section className="resource-section">
          <header>
            <div>
              <span className="eyebrow">Persistent transfer jobs</span>
              <h2>Downloads</h2>
            </div>
            <small>
              Transfers persist outside the page lifecycle. HTTP, cloud,
              WebDAV, S3, and SFTP-style direct transfers share the native
              concurrency queue; BitTorrent and ED2K use their engine queues.
            </small>
          </header>

          <div className="download-manager-toolbar">
            <div className="resource-tabs compact-tabs">
              {(["active", "completed", "failed", "all"] as const).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={
                      transferFilter === filter ? "selected" : ""
                    }
                    onClick={() => setTransferFilter(filter)}
                  >
                    {filter[0].toUpperCase() + filter.slice(1)}
                  </button>
                ),
              )}
            </div>
            <div className="download-manager-controls">
              <label>
                <span>Direct concurrency</span>
                <select
                  value={transferConcurrency}
                  onChange={(event) =>
                    void changeTransferConcurrency(
                      Number(event.target.value),
                    )
                  }
                >
                  {Array.from({ length: 8 }, (_, index) => index + 1).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void clearFinishedDownloads()}
              >
                Clear finished
              </button>
            </div>
          </div>

          {transfers.length === 0 ? (
            <div className="resource-empty">
              <strong>No transfer jobs yet.</strong>
              <p>
                Probe HTTP, choose a Reader-compatible books from OPDS, or preview a magnet
                and select a book file.
              </p>
            </div>
          ) : visibleTransfers.length === 0 ? (
            <div className="resource-empty compact">
              <strong>No {transferFilter} transfer jobs.</strong>
            </div>
          ) : (
            <div className="resource-transfer-list">
              {visibleTransfers.map((job) => (
                <article key={job.id} className={"state-" + job.state}>
                  <div className="resource-transfer-main">
                    <span className="resource-kind-badge">{job.state}</span>
                    <strong>{transferLabel(job)}</strong>
                    <small>
                      {job.providerId} · {job.transportType}
                    </small>

                    <div className="resource-transfer-progress">
                      <span
                        style={{
                          width:
                            Math.round(
                              Math.max(0, Math.min(1, job.progress)) *
                                100,
                            ) + "%",
                        }}
                      />
                    </div>

                    <small>
                      {formatBytes(job.bytesCompleted)}
                      {job.bytesTotal
                        ? " / " + formatBytes(job.bytesTotal)
                        : ""}
                      {job.downloadRate
                        ? " · " +
                          formatBytes(job.downloadRate) +
                          "/s"
                        : ""}
                      {transferEta(job)
                        ? " · ETA " + transferEta(job)
                        : ""}
                      {job.state === "queued"
                        ? " · waiting for a transfer slot"
                        : ""}
                    </small>

                    {job.error && (
                      <small className="resource-transfer-error">
                        {job.error}
                      </small>
                    )}
                  </div>

                  <div className="resource-transfer-actions">
                    <strong>{Math.round(job.progress * 100)}%</strong>

                    {job.state === "running" &&
                      (job.providerId === "http" ||
                        job.providerId === "bittorrent" ||
                        job.providerId === "google-drive" ||
                        job.providerId === "dropbox" ||
                        job.providerId === "onedrive" ||
                        job.providerId === "webdav" ||
                        job.providerId === "s3" ||
                        job.providerId === "sftp" ||
                        job.providerId === "ed2k") && (
                      <>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            void handleTransferAction(job, "pause")
                          }
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            void handleTransferAction(job, "cancel")
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {(job.state === "paused" ||
                      job.state === "failed") &&
                      (job.providerId === "http" ||
                        job.providerId === "bittorrent" ||
                        job.providerId === "google-drive" ||
                        job.providerId === "dropbox" ||
                        job.providerId === "onedrive" ||
                        job.providerId === "webdav" ||
                        job.providerId === "s3" ||
                        job.providerId === "sftp" ||
                        job.providerId === "ed2k") && (
                        <>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              void handleTransferAction(job, "resume")
                            }
                          >
                            {job.state === "failed" ? "Retry" : "Resume"}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() =>
                              void handleTransferAction(job, "discard")
                            }
                          >
                            Discard
                          </button>
                        </>
                      )}

                    {job.state === "completed" &&
                      job.destinationPath && (
                        <button
                          type="button"
                          className="primary-button compact"
                          onClick={() =>
                            void onOpenBook(job.destinationPath!)
                          }
                        >
                          Open
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "accounts" && (
        <section className="resource-section">
          <header>
            <div>
              <span className="eyebrow">Secure provider accounts</span>
              <h2>Resource accounts & engines</h2>
            </div>
            <small>
              Connect cloud accounts or an aMule ED2K sidecar. Passwords and
              access tokens are stored in the operating system secure
              credential store; SQLite stores only account metadata.
            </small>
          </header>

          <div className="ed2k-account-card">
            <div>
              <span className="eyebrow">aMule / aMuled sidecar</span>
              <strong>ED2K engine</strong>
              <small>
                Enable External Connections in aMule. Incoming directory is
                required so LexiPane can detect completed books.
              </small>
            </div>

            <input
              value={ed2kExecutable}
              disabled={ed2kBusy}
              placeholder="amulecmd executable (blank = PATH)"
              onChange={(event) =>
                setEd2kExecutable(event.target.value)
              }
            />
            <input
              value={ed2kHost}
              disabled={ed2kBusy}
              placeholder="Host"
              onChange={(event) =>
                setEd2kHost(event.target.value)
              }
            />
            <input
              value={ed2kPort}
              disabled={ed2kBusy}
              inputMode="numeric"
              placeholder="4712"
              onChange={(event) =>
                setEd2kPort(event.target.value)
              }
            />
            <input
              value={ed2kPassword}
              disabled={ed2kBusy}
              type="password"
              autoComplete="off"
              placeholder="External Connections password"
              onChange={(event) =>
                setEd2kPassword(event.target.value)
              }
            />
            <input
              value={ed2kIncomingDir}
              disabled={ed2kBusy}
              placeholder="aMule Incoming directory"
              onChange={(event) =>
                setEd2kIncomingDir(event.target.value)
              }
            />
            <button
              type="button"
              className="primary-button"
              disabled={ed2kBusy || !ed2kIncomingDir.trim()}
              onClick={() => void connectEd2k()}
            >
              {ed2kBusy ? "Testing…" : "Connect aMule"}
            </button>
          </div>

          {ed2kEngines.length > 0 && (
            <div className="cloud-account-list">
              {ed2kEngines.map((engine) => (
                <article key={engine.id}>
                  <div>
                    <span className="resource-kind-badge">ED2K</span>
                    <strong>
                      {engine.displayName || "aMule ED2K"}
                    </strong>
                    <small>
                      {String(engine.metadata.host ?? "127.0.0.1")}:
                      {String(engine.metadata.port ?? 4712)}
                      {" · "}
                      {String(engine.metadata.incomingDir ?? "")}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setActiveEd2kEngineId(engine.id);
                        setTab("browse");
                      }}
                    >
                      Search
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={ed2kBusy}
                      onClick={() => void disconnectEd2k(engine)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="ed2k-account-card">
            <div>
              <span className="eyebrow">S3-compatible storage</span>
              <strong>Connect object storage</strong>
              <small>
                Compatible with AWS S3, MinIO, R2 and B2 S3 APIs. Access and
                secret keys are stored in the native secure credential store.
              </small>
            </div>

            <input
              value={s3DisplayName}
              disabled={s3Busy}
              placeholder="Account label (optional)"
              onChange={(event) => setS3DisplayName(event.target.value)}
            />
            <input
              value={s3Endpoint}
              disabled={s3Busy}
              placeholder="https://s3.us-east-1.amazonaws.com"
              onChange={(event) => setS3Endpoint(event.target.value)}
            />
            <div className="cloud-token-grid">
              <input
                value={s3Region}
                disabled={s3Busy}
                placeholder="Region, e.g. us-east-1"
                onChange={(event) => setS3Region(event.target.value)}
              />
              <input
                value={s3Bucket}
                disabled={s3Busy}
                placeholder="Bucket"
                onChange={(event) => setS3Bucket(event.target.value)}
              />
            </div>
            <input
              value={s3RootPrefix}
              disabled={s3Busy}
              placeholder="Root prefix (optional), e.g. books/"
              onChange={(event) => setS3RootPrefix(event.target.value)}
            />
            <div className="cloud-token-grid">
              <input
                value={s3AccessKey}
                disabled={s3Busy}
                placeholder="Access key"
                onChange={(event) => setS3AccessKey(event.target.value)}
              />
              <input
                value={s3SecretKey}
                disabled={s3Busy}
                type="password"
                autoComplete="off"
                placeholder="Secret key"
                onChange={(event) => setS3SecretKey(event.target.value)}
              />
            </div>
            <input
              value={s3SessionToken}
              disabled={s3Busy}
              type="password"
              autoComplete="off"
              placeholder="Session token (optional)"
              onChange={(event) => setS3SessionToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connectS3();
              }}
            />
            <button
              type="button"
              className="primary-button"
              disabled={
                s3Busy ||
                !s3Endpoint.trim() ||
                !s3Region.trim() ||
                !s3Bucket.trim() ||
                !s3AccessKey.trim() ||
                !s3SecretKey
              }
              onClick={() => void connectS3()}
            >
              {s3Busy ? "Connecting…" : "Connect S3"}
            </button>
          </div>

          {s3Accounts.length > 0 && (
            <div className="cloud-account-list">
              {s3Accounts.map((account) => (
                <article key={account.id}>
                  <div>
                    <span className="resource-kind-badge">S3</span>
                    <strong>{account.displayName || "S3"}</strong>
                    <small>
                      {String(account.metadata.bucket ?? "")}
                      {" · "}
                      {String(account.metadata.endpoint ?? "")}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={s3Busy}
                      onClick={() => {
                        setTab("browse");
                        void openS3Root(account);
                      }}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={s3Busy}
                      onClick={() => void disconnectS3(account)}
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="ed2k-account-card">
            <div>
              <span className="eyebrow">SFTP</span>
              <strong>Connect SSH file storage</strong>
              <small>
                Use password authentication or a local private-key file.
                Secrets stay in the operating-system credential store.
              </small>
            </div>

            <input
              value={sftpDisplayName}
              disabled={sftpBusy}
              placeholder="Account label (optional)"
              onChange={(event) =>
                setSftpDisplayName(event.target.value)
              }
            />

            <div className="cloud-token-grid">
              <input
                value={sftpHost}
                disabled={sftpBusy}
                placeholder="Host"
                onChange={(event) =>
                  setSftpHost(event.target.value)
                }
              />
              <input
                value={sftpPort}
                disabled={sftpBusy}
                inputMode="numeric"
                placeholder="22"
                onChange={(event) =>
                  setSftpPort(event.target.value)
                }
              />
            </div>

            <input
              value={sftpUsername}
              disabled={sftpBusy}
              placeholder="Username"
              onChange={(event) =>
                setSftpUsername(event.target.value)
              }
            />

            <input
              value={sftpRootPath}
              disabled={sftpBusy}
              placeholder="Root path, e.g. /books"
              onChange={(event) =>
                setSftpRootPath(event.target.value)
              }
            />

            <input
              value={sftpPassword}
              disabled={sftpBusy}
              type="password"
              autoComplete="off"
              placeholder="Password (leave blank when using a private key)"
              onChange={(event) =>
                setSftpPassword(event.target.value)
              }
            />

            <details className="cloud-oauth-advanced">
              <summary>Private-key authentication</summary>
              <p>
                Enter the local private-key path. Add a passphrase only if the
                key is encrypted.
              </p>
              <input
                value={sftpPrivateKeyPath}
                disabled={sftpBusy}
                placeholder="Private key path, e.g. C:\Users\me\.ssh\id_ed25519"
                onChange={(event) =>
                  setSftpPrivateKeyPath(event.target.value)
                }
              />
              <input
                value={sftpPrivateKeyPassphrase}
                disabled={sftpBusy}
                type="password"
                autoComplete="off"
                placeholder="Private key passphrase (optional)"
                onChange={(event) =>
                  setSftpPrivateKeyPassphrase(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void connectSftp();
                  }
                }}
              />
            </details>

            <button
              type="button"
              className="primary-button"
              disabled={
                sftpBusy ||
                !sftpHost.trim() ||
                !sftpUsername.trim() ||
                (!sftpPassword && !sftpPrivateKeyPath.trim())
              }
              onClick={() => void connectSftp()}
            >
              {sftpBusy ? "Connecting…" : "Connect SFTP"}
            </button>
          </div>

          {sftpAccounts.length > 0 && (
            <div className="cloud-account-list">
              {sftpAccounts.map((account) => (
                <article key={account.id}>
                  <div>
                    <span className="resource-kind-badge">SFTP</span>
                    <strong>{account.displayName || "SFTP"}</strong>
                    <small>
                      {String(account.metadata.username ?? "")}
                      {"@"}
                      {String(account.metadata.host ?? "")}
                      {":"}
                      {String(account.metadata.port ?? 22)}
                      {" · "}
                      {String(account.metadata.authMode ?? "password")}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={sftpBusy}
                      onClick={() => {
                        setTab("browse");
                        void openSftpRoot(account);
                      }}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={sftpBusy}
                      onClick={() => void disconnectSftp(account)}
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="ed2k-account-card">
            <div>
              <span className="eyebrow">WebDAV / Nextcloud</span>
              <strong>Connect WebDAV storage</strong>
              <small>
                Use the WebDAV endpoint, such as a Nextcloud
                /remote.php/dav/files/USERNAME/ URL. Passwords are stored in
                the native secure credential store.
              </small>
            </div>

            <input
              value={webDavDisplayName}
              disabled={webDavBusy}
              placeholder="Account label (optional)"
              onChange={(event) =>
                setWebDavDisplayName(event.target.value)
              }
            />
            <input
              value={webDavBaseUrl}
              disabled={webDavBusy}
              placeholder="https://server.example/remote.php/dav/files/user/"
              onChange={(event) =>
                setWebDavBaseUrl(event.target.value)
              }
            />
            <input
              value={webDavUsername}
              disabled={webDavBusy}
              placeholder="Username"
              onChange={(event) =>
                setWebDavUsername(event.target.value)
              }
            />
            <input
              value={webDavPassword}
              disabled={webDavBusy}
              type="password"
              autoComplete="off"
              placeholder="Password / app password"
              onChange={(event) =>
                setWebDavPassword(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void connectWebDav();
                }
              }}
            />
            <button
              type="button"
              className="primary-button"
              disabled={webDavBusy || !webDavBaseUrl.trim()}
              onClick={() => void connectWebDav()}
            >
              {webDavBusy ? "Connecting…" : "Connect WebDAV"}
            </button>
          </div>

          {webDavAccounts.length > 0 && (
            <div className="cloud-account-list">
              {webDavAccounts.map((account) => (
                <article key={account.id}>
                  <div>
                    <span className="resource-kind-badge">WebDAV</span>
                    <strong>
                      {account.displayName || "WebDAV"}
                    </strong>
                    <small>
                      {String(account.metadata.baseUrl ?? "")}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={webDavBusy}
                      onClick={() => {
                        setTab("browse");
                        void openWebDavRoot(account);
                      }}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={webDavBusy}
                      onClick={() => void disconnectWebDav(account)}
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="cloud-connect-card">
            <select
              value={connectProvider}
              disabled={cloudBusy}
              onChange={(event) =>
                setConnectProvider(
                  event.target.value as CloudProviderId,
                )
              }
            >
              <option value="google-drive">Google Drive</option>
              <option value="dropbox">Dropbox</option>
              <option value="onedrive">OneDrive / SharePoint</option>
            </select>

            <input
              value={connectDisplayName}
              disabled={cloudBusy}
              placeholder="Account label (optional)"
              onChange={(event) =>
                setConnectDisplayName(event.target.value)
              }
            />

            <input
              value={connectToken}
              disabled={cloudBusy}
              type="password"
              autoComplete="off"
              placeholder="OAuth access token (optional if refresh token is configured)"
              onChange={(event) =>
                setConnectToken(event.target.value)
              }
            />

            <details className="cloud-oauth-advanced">
              <summary>Automatic token refresh (optional)</summary>
              <p>
                Add the OAuth refresh token and client id so LexiPane can renew
                expired access tokens. Client secret is optional for public
                clients. OneDrive can also specify a tenant.
              </p>

              <input
                value={connectRefreshToken}
                disabled={cloudBusy}
                type="password"
                autoComplete="off"
                placeholder="Refresh token"
                onChange={(event) =>
                  setConnectRefreshToken(event.target.value)
                }
              />
              <input
                value={connectClientId}
                disabled={cloudBusy}
                placeholder="OAuth client id"
                onChange={(event) =>
                  setConnectClientId(event.target.value)
                }
              />
              <input
                value={connectClientSecret}
                disabled={cloudBusy}
                type="password"
                autoComplete="off"
                placeholder="OAuth client secret (optional)"
                onChange={(event) =>
                  setConnectClientSecret(event.target.value)
                }
              />
              {connectProvider === "onedrive" && (
                <input
                  value={connectTenant}
                  disabled={cloudBusy}
                  placeholder="Microsoft tenant (default: common)"
                  onChange={(event) =>
                    setConnectTenant(event.target.value)
                  }
                />
              )}
            </details>

            <button
              type="button"
              className="primary-button"
              disabled={
                cloudBusy ||
                (!connectToken.trim() &&
                  !(
                    connectRefreshToken.trim() &&
                    connectClientId.trim()
                  ))
              }
              onClick={() => void connectCloud()}
            >
              {cloudBusy ? "Verifying…" : "Connect"}
            </button>
          </div>

          {cloudAccounts.length === 0 ? (
            <div className="resource-empty">
              <strong>No connected cloud accounts.</strong>
              <p>
                Once connected, the account becomes available in Browse for
                folder navigation, search, and Reader-compatible acquisition.
              </p>
            </div>
          ) : (
            <div className="cloud-account-list">
              {cloudAccounts.map((account) => (
                <article key={account.id}>
                  <div>
                    <span className="resource-kind-badge">
                      {account.providerId}
                    </span>
                    <strong>
                      {account.displayName || account.providerId}
                    </strong>
                    <small>
                      Connected ·{" "}
                      {String(
                        account.metadata.connectionMode ?? "access-token",
                      )}
                      {" · "}credentials stored outside SQLite
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={cloudBusy}
                      onClick={() => {
                        setTab("browse");
                        void openCloudRoot(account);
                      }}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={cloudBusy}
                      onClick={() => void disconnectCloud(account)}
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

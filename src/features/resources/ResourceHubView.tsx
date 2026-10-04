import { useEffect, useMemo, useState } from "react";
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
  fetchOpdsCatalog,
  searchOpdsCatalog,
  type OpdsEntry,
  type OpdsFeed,
  type OpdsLink,
} from "../../core/resources/opds";
import {
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
  RESOURCE_TRANSFER_UPDATED_EVENT,
} from "../../core/resources/runtime";
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

function opdsLinkLabel(link: OpdsLink): string {
  if (link.type === "application/epub+zip") return "Get EPUB";
  if (link.type === "application/pdf") return "Get PDF";
  return link.title || "Get book";
}

export function ResourceHubView({ onOpenBook }: Props) {
  const [tab, setTab] = useState<ResourceHubTab>("search");
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
    ] = await Promise.all([
      getResourceNativeCapabilities(),
      listPersistedResourceProviders(),
      listTransferJobs(),
      listResourceItems(),
      listResourceCatalogs(),
      listConnectedCloudAccounts(),
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
    setActiveCloudAccountId((current) =>
      current &&
      connectedCloudAccounts.some((account) => account.id === current)
        ? current
        : connectedCloudAccounts[0]?.id ?? null,
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

  function inspectInput() {
    const next = classifyResourceInput(input);
    setClassification(next);
    setHttpPreparation(null);
    setTorrentPreview(null);
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

  async function handleTransferAction(
    job: TransferJob,
    action: "pause" | "resume" | "cancel" | "discard",
  ) {
    setMessage("");

    try {
      const torrent = job.providerId === "bittorrent";

      if (action === "pause") {
        if (torrent) {
          await pauseTorrentDownload(job.id);
        } else {
          await pauseHttpDownload(job.id);
        }
      } else if (action === "cancel") {
        if (torrent) {
          await cancelTorrentDownload(job.id);
        } else {
          await cancelHttpDownload(job.id);
        }
      } else if (action === "discard") {
        if (torrent) {
          await discardTorrentTransfer(job);
        } else {
          await discardHttpTransfer(job);
        }
        await refreshResourceCore();
      } else if (torrent) {
        await resumeTorrentTransfer(job);
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
  const canBrowseOpds = classification?.kind === "opds";
  const canPreviewTorrent =
    classification?.kind === "magnet" ||
    classification?.kind === "torrent";

  return (
    <div className="page resource-hub-page">
      <header className="page-header resource-hub-header">
        <div>
          <span className="eyebrow">Resource acquisition platform</span>
          <h1>Find it. Inspect it. Bring it into your library.</h1>
          <p>
            HTTP acquisition is now live. OPDS discovery uses the same
            persistent transfer and verified Library-ingestion pipeline.
          </p>
        </div>

        <div className="resource-core-status">
          <span className="resource-status-dot" />
          <div>
            <strong>
              {loading ? "Starting Resource Hub…" : "Resource Hub ready"}
            </strong>
            <small>
              RESOURCE-002 · {liveTransportCount} live transport(s)
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
                HTTP/HTTPS is live for validated PDF/EPUB acquisition. Cloud
                OAuth, BitTorrent, and ED2K networking remain disabled.
              </p>
            </div>
          </aside>
        </div>
      )}

      {tab === "browse" && (
        <div className="resource-browse-stack">
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
                Live means an implementation exists. Cloud and P2P providers
                remain contract-only.
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
              HTTP and BitTorrent jobs run in the native layer and remain
              active when you navigate elsewhere in LexiPane.
            </small>
          </header>

          {transfers.length === 0 ? (
            <div className="resource-empty">
              <strong>No transfer jobs yet.</strong>
              <p>
                Probe HTTP, choose a PDF/EPUB from OPDS, or preview a magnet
                and select a book file.
              </p>
            </div>
          ) : (
            <div className="resource-transfer-list">
              {transfers.map((job) => (
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
                        job.providerId === "bittorrent") && (
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
                        job.providerId === "bittorrent") && (
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
              <h2>Accounts</h2>
            </div>
          </header>

          <div className="resource-empty">
            <strong>Cloud OAuth remains intentionally disabled.</strong>
            <p>
              Google Drive, Dropbox, and OneDrive account connection begins in
              RESOURCE-003. Tokens will use native secure credential storage,
              never SQLite.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

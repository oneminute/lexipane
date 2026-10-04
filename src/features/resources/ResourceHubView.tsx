import { useEffect, useMemo, useState } from "react";
import { getResourceNativeCapabilities } from "../../core/resources/native";
import {
  createDraftTransferJob,
  listPersistedResourceProviders,
  listResourceItems,
  listTransferJobs,
  syncBuiltinResourceProviders,
  type PersistedResourceProvider,
} from "../../core/resources/persistence";
import {
  listResourceProviders,
} from "../../core/resources/registry";
import { classifyResourceInput } from "../../core/resources/resolver";
import type {
  ResourceInputClassification,
  ResourceItem,
  ResourceNativeCapabilities,
  ResourceProviderCapabilities,
  ResourceProviderKind,
  TransferJob,
} from "../../core/resources/types";

type ResourceHubTab = "search" | "browse" | "downloads" | "accounts";

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

export function ResourceHubView() {
  const [tab, setTab] = useState<ResourceHubTab>("search");
  const [input, setInput] = useState("");
  const [classification, setClassification] =
    useState<ResourceInputClassification | null>(null);
  const [providers, setProviders] =
    useState<ProviderView[]>(fallbackProviderViews);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [nativeCapabilities, setNativeCapabilities] =
    useState<ResourceNativeCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);

  const liveTransportCount = useMemo(() => {
    if (!nativeCapabilities) return 0;
    return Object.values(nativeCapabilities.liveTransports).filter(Boolean)
      .length;
  }, [nativeCapabilities]);

  async function refreshResourceCore() {
    const [native, persistedProviders, jobs, items] =
      await Promise.all([
        getResourceNativeCapabilities(),
        listPersistedResourceProviders(),
        listTransferJobs(),
        listResourceItems(),
      ]);

    setNativeCapabilities(native);
    setProviders(
      persistedProviders.length > 0
        ? persistedProviders.map(providerView)
        : fallbackProviderViews(),
    );
    setTransfers(jobs);
    setResources(items);
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await syncBuiltinResourceProviders();

        if (cancelled) return;
        await refreshResourceCore();
      } catch (error) {
        console.error("Unable to initialize Resource Core", error);
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to initialize Resource Core.",
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

  function inspectInput() {
    const next = classifyResourceInput(input);
    setClassification(next);
    setMessage(
      next.startsNetworkActivity
        ? ""
        : "Classification only — no network request was sent.",
    );
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

  return (
    <div className="page resource-hub-page">
      <header className="page-header resource-hub-header">
        <div>
          <span className="eyebrow">Resource acquisition platform</span>
          <h1>Find it. Inspect it. Bring it into your library.</h1>
          <p>
            Resource Core normalizes cloud, catalog, web, and P2P inputs
            before any provider is allowed to perform network activity.
          </p>
        </div>

        <div className="resource-core-status">
          <span className="resource-status-dot" />
          <div>
            <strong>
              {loading ? "Starting Resource Core…" : "Resource Core ready"}
            </strong>
            <small>
              {liveTransportCount === 0
                ? "RESOURCE-001 · live transfers disabled"
                : liveTransportCount + " live transport(s)"}
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
              URL, magnet, ED2K link, cloud share link, OPDS catalog,
              WebDAV/S3/SFTP address, or torrent metadata path.
            </p>

            <div className="resource-input-row">
              <input
                value={input}
                placeholder="Paste URL, magnet, ED2K link, share link, or catalog address…"
                onChange={(event) => {
                  setInput(event.target.value);
                  setClassification(null);
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
                    <dt>Network</dt>
                    <dd>Not started</dd>
                  </div>
                </dl>

                <code>{classification.normalizedInput || "—"}</code>

                <div className="resource-classification-actions">
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
                  <small>
                    Draft jobs are inert. A future milestone will resolve and
                    transfer them.
                  </small>
                </div>
              </div>
            )}
          </section>

          <aside className="resource-summary-card">
            <span className="eyebrow">Core inventory</span>
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
                <strong>{liveTransportCount}</strong>
                <span>live transports</span>
              </div>
            </div>

            <div className="resource-safety-note">
              <strong>RESOURCE-001 boundary</strong>
              <p>
                Classification, persistence, and provider capability
                discovery are enabled. HTTP, cloud, BitTorrent, and ED2K
                transfer engines remain disabled.
              </p>
            </div>
          </aside>
        </div>
      )}

      {tab === "browse" && (
        <section className="resource-section">
          <header>
            <div>
              <span className="eyebrow">Provider registry</span>
              <h2>Available contracts</h2>
            </div>
            <small>
              Contracts describe future abilities; they do not imply a live
              connection.
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
      )}

      {tab === "downloads" && (
        <section className="resource-section">
          <header>
            <div>
              <span className="eyebrow">Persistent transfer jobs</span>
              <h2>Downloads</h2>
            </div>
            <small>
              RESOURCE-001 only stores inert job state. No transfer engine is
              active yet.
            </small>
          </header>

          {transfers.length === 0 ? (
            <div className="resource-empty">
              <strong>No transfer jobs yet.</strong>
              <p>
                Inspect a supported resource input and save it as a draft to
                verify the persistent job model.
              </p>
            </div>
          ) : (
            <div className="resource-transfer-list">
              {transfers.map((job) => (
                <article key={job.id}>
                  <div>
                    <span className="resource-kind-badge">{job.state}</span>
                    <strong>{transferLabel(job)}</strong>
                    <small>
                      {job.providerId} · {job.transportType}
                    </small>
                  </div>
                  <span>{Math.round(job.progress * 100)}%</span>
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
            <strong>Account contracts are reserved, but OAuth is not active.</strong>
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

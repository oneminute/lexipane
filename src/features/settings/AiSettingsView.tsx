import { useEffect, useState } from "react";
import { ProviderConnections } from "./ProviderConnections";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "../../core/ai/ollamaConfig";
import {
  listProviderConfigs,
  type ProviderConfig,
} from "../../core/ai/providerConfigs";
import {
  loadAiPrivacyMode,
  saveAiPrivacyMode,
  type AiPrivacyMode,
} from "../../core/ai/privacy";
import { OllamaProvider } from "../../core/ai/providers/ollama";
import { providerCatalog } from "../../core/ai/registry";
import {
  loadTaskRouteTarget,
  saveTaskRouteTarget,
  type ReadingTaskType,
  type TaskRouteTarget,
} from "../../core/ai/taskRouting";
import type { ModelInfo } from "../../core/ai/types";
import {
  getAiUsageSummary,
  type AiUsageSummary,
} from "../../core/ai/usage";
import {
  getReadingProfileSummary,
  type ReadingProfileSummary,
} from "../../core/reading/knownTerms";
import {
  loadReadingLevel,
  readingLevels,
  saveReadingLevel,
  type ReadingLevel,
} from "../../core/reading/preferences";

const groups = [
  { key: "local", label: "Local AI" },
  { key: "global", label: "Global cloud" },
  { key: "china", label: "China cloud" },
] as const;

const taskRoutes: Array<{
  id: ReadingTaskType;
  label: string;
  description: string;
}> = [
  {
    id: "difficulty",
    label: "Automatic reading help",
    description: "Difficult words and phrases",
  },
  {
    id: "explain",
    label: "Context explanation",
    description: "Selected words and phrases",
  },
  {
    id: "grammar",
    label: "Sentence analysis",
    description: "Grammar and structure",
  },
  {
    id: "ask",
    label: "Reader questions",
    description: "Free-form questions about selected text",
  },
  {
    id: "region",
    label: "Region / image",
    description: "Charts, scanned text, formulas, and illustrations",
  },
];

type OllamaStatus = "checking" | "connected" | "offline";

const emptyUsage: AiUsageSummary = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  averageLatencyMs: 0,
};

const emptyReadingProfile: ReadingProfileSummary = {
  known: 0,
  difficult: 0,
  suppressed: 0,
  totalSignals: 0,
};

function encodeRoute(target: TaskRouteTarget): string {
  return JSON.stringify(target);
}

function decodeRoute(value: string): TaskRouteTarget | null {
  try {
    const parsed = JSON.parse(value) as Partial<TaskRouteTarget>;

    if (
      parsed.kind === "ollama" &&
      typeof parsed.model === "string" &&
      parsed.model
    ) {
      return {
        kind: "ollama",
        model: parsed.model,
      };
    }

    if (
      parsed.kind === "provider" &&
      typeof parsed.configId === "string" &&
      parsed.configId &&
      typeof parsed.model === "string" &&
      parsed.model
    ) {
      return {
        kind: "provider",
        configId: parsed.configId,
        model: parsed.model,
      };
    }
  } catch {
    return null;
  }

  return null;
}

const privacyModes: Array<{
  id: AiPrivacyMode;
  label: string;
}> = [
  { id: "local-only", label: "Local only" },
  { id: "prefer-local", label: "Prefer local" },
  { id: "automatic", label: "Automatic" },
  { id: "cloud-only", label: "Cloud only" },
];

export function AiSettingsView() {
  const [ollamaStatus, setOllamaStatus] =
    useState<OllamaStatus>("checking");
  const [ollamaMessage, setOllamaMessage] = useState(
    "Checking local Ollama…",
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>("B2");
  const [routes, setRoutes] =
    useState<Partial<Record<ReadingTaskType, TaskRouteTarget>>>({});
  const [providerConfigs, setProviderConfigs] =
    useState<ProviderConfig[]>([]);
  const [privacyMode, setPrivacyMode] =
    useState<AiPrivacyMode>("prefer-local");
  const [usage, setUsage] = useState<AiUsageSummary>(emptyUsage);
  const [readingProfile, setReadingProfile] =
    useState<ReadingProfileSummary>(emptyReadingProfile);

  async function refreshProviderConfigs() {
    setProviderConfigs(
      (await listProviderConfigs()).filter((config) => config.enabled),
    );
  }

  async function loadPreferences() {
    const [
      level,
      usageSummary,
      privacy,
      configuredProviders,
      profileSummary,
      ...routeValues
    ] = await Promise.all([
      loadReadingLevel(),
      getAiUsageSummary(),
      loadAiPrivacyMode(),
      listProviderConfigs(),
      getReadingProfileSummary(),
      ...taskRoutes.map((task) => loadTaskRouteTarget(task.id)),
    ]);

    setReadingLevel(level);
    setUsage(usageSummary);
    setPrivacyMode(privacy);
    setReadingProfile(profileSummary);
    setProviderConfigs(
      configuredProviders.filter((config) => config.enabled),
    );

    const nextRoutes: Partial<
      Record<ReadingTaskType, TaskRouteTarget>
    > = {};
    taskRoutes.forEach((task, index) => {
      const value = routeValues[index] as TaskRouteTarget | null;
      if (value) nextRoutes[task.id] = value;
    });
    setRoutes(nextRoutes);
  }

  async function refreshOllama() {
    setRefreshing(true);
    setOllamaStatus("checking");
    setOllamaMessage("Checking local Ollama…");

    try {
      const config = await loadOllamaConfig();
      const provider = new OllamaProvider(config.baseUrl);
      const connection = await provider.testConnection();

      if (!connection.ok) {
        setModels([]);
        setOllamaStatus("offline");
        setOllamaMessage(connection.message);
        return;
      }

      const discovered = await provider.listModels();
      const preferred = choosePreferredOllamaModel(
        discovered,
        config.model,
      );

      setModels(discovered);
      setSelectedModel(preferred ?? "");
      setOllamaStatus("connected");

      if (preferred && preferred !== config.model) {
        await saveOllamaModel(preferred);
      }

      setOllamaMessage(
        discovered.length > 0
          ? "Connected · " +
              discovered.length +
              " local model(s) discovered"
          : "Connected, but no local models are installed.",
      );
    } catch (error) {
      setModels([]);
      setOllamaStatus("offline");
      setOllamaMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to Ollama.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void Promise.all([refreshOllama(), loadPreferences()]);
  }, []);

  async function changeModel(model: string) {
    setSelectedModel(model);
    if (model) {
      await saveOllamaModel(model);
    }
  }

  async function changeReadingLevel(level: ReadingLevel) {
    setReadingLevel(level);
    await saveReadingLevel(level);
  }

  async function changePrivacyMode(mode: AiPrivacyMode) {
    setPrivacyMode(mode);
    await saveAiPrivacyMode(mode);
  }

  async function changeTaskRoute(
    task: ReadingTaskType,
    encoded: string,
  ) {
    const target = decodeRoute(encoded);
    if (!target) return;

    setRoutes((current) => ({
      ...current,
      [task]: target,
    }));
    await saveTaskRouteTarget(task, target);
  }

  function currentRouteValue(task: ReadingTaskType): string {
    const target = routes[task];

    if (target) {
      return encodeRoute(target);
    }

    return selectedModel
      ? encodeRoute({
          kind: "ollama",
          model: selectedModel,
        })
      : "";
  }

  function cloudRouteOptions(task: ReadingTaskType) {
    return providerConfigs.filter((config) => {
      if (!config.settings.model) return false;

      if (task !== "region") return true;

      const descriptor = providerCatalog.find(
        (provider) => provider.id === config.providerId,
      );

      return (
        descriptor?.adapter === "openai-compatible" ||
        descriptor?.adapter === "anthropic-native" ||
        descriptor?.adapter === "gemini-native"
      );
    });
  }

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">AI Platform</span>
          <h1>One reader, any model.</h1>
          <p>
            LexiPane can route reading tasks to local Ollama or securely
            configured cloud providers. Text responses stream as they arrive,
            and region/image analysis can use local or cloud multimodal models.
          </p>
        </div>
      </header>

      <section className="ollama-config-card">
        <div className="ollama-config-heading">
          <div>
            <span className="provider-logo">OL</span>
            <div>
              <span className="eyebrow">Local AI · Live</span>
              <h2>Ollama</h2>
            </div>
          </div>
          <span
            className={
              ollamaStatus === "connected"
                ? "connection-badge connected"
                : ollamaStatus === "checking"
                  ? "connection-badge checking"
                  : "connection-badge offline"
            }
          >
            {ollamaStatus}
          </span>
        </div>

        <p className="ollama-message">{ollamaMessage}</p>

        <div className="ollama-controls">
          <label>
            <span>Server</span>
            <input value="http://127.0.0.1:11434" readOnly />
          </label>

          <label>
            <span>Default local model</span>
            <select
              value={selectedModel}
              disabled={models.length === 0}
              onChange={(event) => void changeModel(event.target.value)}
            >
              {models.length === 0 && (
                <option value="">No model discovered</option>
              )}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="ghost-button"
            disabled={refreshing}
            onClick={() => void refreshOllama()}
          >
            {refreshing ? "Checking…" : "Refresh models"}
          </button>
        </div>

        <small className="ollama-hint">
          Installed models are discovered automatically. Qwen 3.5 is preferred
          when no local default has been selected.
        </small>
      </section>

      <ProviderConnections
        onChanged={() => void refreshProviderConfigs()}
      />

      <div className="settings-grid">
        <section className="settings-card">
          <span className="eyebrow">Reading profile</span>
          <h2>Automatic difficulty level</h2>
          <p>
            This controls how aggressively LexiPane marks vocabulary and
            expressions that may interrupt reading.
          </p>
          <select
            className="settings-select"
            value={readingLevel}
            onChange={(event) =>
              void changeReadingLevel(
                event.target.value as ReadingLevel,
              )
            }
          >
            {readingLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
          <small className="settings-help">
            {
              readingLevels.find(
                (level) => level.id === readingLevel,
              )?.description
            }
          </small>
        </section>

        <section className="settings-card">
          <span className="eyebrow">Privacy mode</span>
          <h2>
            {
              privacyModes.find(
                (mode) => mode.id === privacyMode,
              )?.label
            }
          </h2>
          <p>
            Local only never sends book content to configured cloud providers.
            Prefer local uses cloud only for tasks you explicitly route there.
            Automatic can fall back to cloud when local AI is unavailable.
          </p>
          <div className="mode-row">
            {privacyModes.map((mode) => (
              <button
                key={mode.id}
                className={
                  privacyMode === mode.id ? "selected" : ""
                }
                onClick={() =>
                  void changePrivacyMode(mode.id)
                }
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-card routing-card">
          <span className="eyebrow">Task routing</span>
          <h2>Choose a provider and model per task</h2>
          <p>
            Automatic page analysis can stay on a fast local model while
            grammar and difficult questions use a stronger configured model.
          </p>
          <div className="task-route-list">
            {taskRoutes.map((task) => {
              const clouds = cloudRouteOptions(task.id);
              const noRoutes =
                models.length === 0 && clouds.length === 0;

              return (
                <label key={task.id} className="task-route-row">
                  <span>
                    <strong>{task.label}</strong>
                    <small>{task.description}</small>
                  </span>
                  <select
                    value={currentRouteValue(task.id)}
                    disabled={noRoutes}
                    onChange={(event) =>
                      void changeTaskRoute(
                        task.id,
                        event.target.value,
                      )
                    }
                  >
                    {noRoutes && (
                      <option value="">No model available</option>
                    )}

                    {models.length > 0 && (
                      <optgroup label="Ollama · local">
                        {models.map((model) => {
                          const target: TaskRouteTarget = {
                            kind: "ollama",
                            model: model.id,
                          };
                          return (
                            <option
                              key={"ollama:" + model.id}
                              value={encodeRoute(target)}
                            >
                              {model.name}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}

                    {clouds.length > 0 && (
                      <optgroup label="Configured providers">
                        {clouds.map((config) => {
                          const model =
                            config.settings.model ?? "";
                          const target: TaskRouteTarget = {
                            kind: "provider",
                            configId: config.id,
                            model,
                          };
                          return (
                            <option
                              key={
                                "provider:" +
                                config.id +
                                ":" +
                                model
                              }
                              value={encodeRoute(target)}
                            >
                              {config.displayName} · {model}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                </label>
              );
            })}
          </div>
        </section>

        <section className="settings-card reading-profile-card">
          <span className="eyebrow">Personal reading model</span>
          <h2>{readingProfile.totalSignals.toLocaleString()} feedback signals</h2>
          <p>
            LexiPane uses Known, Remove, and manually highlighted difficult
            terms to personalize future automatic reading assistance.
          </p>
          <div className="usage-metrics">
            <div>
              <strong>{readingProfile.known.toLocaleString()}</strong>
              <span>known</span>
            </div>
            <div>
              <strong>{readingProfile.difficult.toLocaleString()}</strong>
              <span>difficult</span>
            </div>
            <div>
              <strong>{readingProfile.suppressed.toLocaleString()}</strong>
              <span>removed</span>
            </div>
          </div>
        </section>

        <section className="settings-card usage-card">
          <span className="eyebrow">AI usage</span>
          <h2>{usage.requests.toLocaleString()} requests</h2>
          <p>
            Tokens and latency are tracked locally for both local and configured
            providers. Provider billing estimates will be added separately.
          </p>
          <div className="usage-metrics">
            <div>
              <strong>{usage.totalTokens.toLocaleString()}</strong>
              <span>tokens</span>
            </div>
            <div>
              <strong>
                {usage.averageLatencyMs.toLocaleString()} ms
              </strong>
              <span>avg latency</span>
            </div>
            <div>
              <strong>Local</strong>
              <span>usage log</span>
            </div>
          </div>
        </section>
      </div>

      <div className="provider-section">
        {groups.map((group) => {
          const providers = providerCatalog.filter(
            (provider) => provider.region === group.key,
          );

          return (
            <section key={group.key}>
              <div className="section-heading">
                <h2>{group.label}</h2>
                <span>{providers.length} providers</span>
              </div>
              <div className="provider-grid">
                {providers.map((provider) => (
                  <article className="provider-card" key={provider.id}>
                    <div className="provider-topline">
                      <span className="provider-logo">
                        {provider.shortLabel}
                      </span>
                      <span
                        className={
                          provider.status === "core"
                            ? "status-chip ready"
                            : "status-chip"
                        }
                      >
                        {provider.status === "core"
                          ? "adapter ready"
                          : "cataloged"}
                      </span>
                    </div>
                    <h3>{provider.name}</h3>
                    <p>{provider.description}</p>
                    <footer>
                      <code>{provider.adapter}</code>
                      {provider.defaultBaseUrl && (
                        <small>{provider.defaultBaseUrl}</small>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { ProviderConnections } from "./ProviderConnections";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "../../core/ai/ollamaConfig";
import { OllamaProvider } from "../../core/ai/providers/ollama";
import { providerCatalog } from "../../core/ai/registry";
import {
  loadTaskModel,
  saveTaskModel,
  type ReadingTaskType,
} from "../../core/ai/taskRouting";
import type { ModelInfo } from "../../core/ai/types";
import {
  getAiUsageSummary,
  type AiUsageSummary,
} from "../../core/ai/usage";
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
    useState<Partial<Record<ReadingTaskType, string>>>({});
  const [usage, setUsage] = useState<AiUsageSummary>(emptyUsage);

  async function loadPreferences() {
    const [level, usageSummary, ...routeValues] = await Promise.all([
      loadReadingLevel(),
      getAiUsageSummary(),
      ...taskRoutes.map((task) => loadTaskModel(task.id)),
    ]);

    setReadingLevel(level);
    setUsage(usageSummary);

    const nextRoutes: Partial<Record<ReadingTaskType, string>> = {};
    taskRoutes.forEach((task, index) => {
      const value = routeValues[index];
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
          ? "Connected · " + discovered.length + " local model(s) discovered"
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

  async function changeTaskRoute(
    task: ReadingTaskType,
    model: string,
  ) {
    setRoutes((current) => ({
      ...current,
      [task]: model,
    }));
    await saveTaskModel(task, model);
  }

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">AI Platform</span>
          <h1>One reader, any model.</h1>
          <p>
            LexiPane separates reading tasks from model providers. Local
            Ollama is live now, including task-specific model routing,
            automatic reading assistance, caching, and local usage tracking.
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
          Installed models are discovered automatically. If a reading task
          does not have its own route, it falls back to the default local
          model.
        </small>
      </section>

      <ProviderConnections />

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
              void changeReadingLevel(event.target.value as ReadingLevel)
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
              readingLevels.find((level) => level.id === readingLevel)
                ?.description
            }
          </small>
        </section>

        <section className="settings-card">
          <span className="eyebrow">Privacy mode</span>
          <h2>Prefer local</h2>
          <p>
            Reading assistance currently stays local through Ollama. Cloud
            escalation will remain explicit when selected content would leave
            the device.
          </p>
          <div className="mode-row">
            <button>Local only</button>
            <button className="selected">Prefer local</button>
            <button disabled>Automatic</button>
            <button disabled>Cloud only</button>
          </div>
        </section>

        <section className="settings-card routing-card">
          <span className="eyebrow">Task routing</span>
          <h2>Choose a model per reading task</h2>
          <p>
            Faster models can handle automatic page analysis while a stronger
            local model handles grammar or complex questions.
          </p>
          <div className="task-route-list">
            {taskRoutes.map((task) => (
              <label key={task.id} className="task-route-row">
                <span>
                  <strong>{task.label}</strong>
                  <small>{task.description}</small>
                </span>
                <select
                  value={routes[task.id] ?? selectedModel}
                  disabled={models.length === 0}
                  onChange={(event) =>
                    void changeTaskRoute(task.id, event.target.value)
                  }
                >
                  {models.length === 0 && (
                    <option value="">No model</option>
                  )}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-card usage-card">
          <span className="eyebrow">Local usage</span>
          <h2>{usage.requests.toLocaleString()} AI requests</h2>
          <p>
            Local usage is tracked for performance feedback. Ollama requests
            have no API charge.
          </p>
          <div className="usage-metrics">
            <div>
              <strong>{usage.totalTokens.toLocaleString()}</strong>
              <span>tokens</span>
            </div>
            <div>
              <strong>{usage.averageLatencyMs.toLocaleString()} ms</strong>
              <span>avg latency</span>
            </div>
            <div>
              <strong>$0</strong>
              <span>API cost</span>
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
                      <span className="provider-logo">{provider.shortLabel}</span>
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

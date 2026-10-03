import { useEffect, useState } from "react";
import {
  choosePreferredOllamaModel,
  loadOllamaConfig,
  saveOllamaModel,
} from "../../core/ai/ollamaConfig";
import { OllamaProvider } from "../../core/ai/providers/ollama";
import { providerCatalog } from "../../core/ai/registry";
import type { ModelInfo } from "../../core/ai/types";

const groups = [
  { key: "local", label: "Local AI" },
  { key: "global", label: "Global cloud" },
  { key: "china", label: "China cloud" },
] as const;

type OllamaStatus = "checking" | "connected" | "offline";

export function AiSettingsView() {
  const [ollamaStatus, setOllamaStatus] =
    useState<OllamaStatus>("checking");
  const [ollamaMessage, setOllamaMessage] = useState(
    "Checking local Ollama…",
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [refreshing, setRefreshing] = useState(false);

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
    void refreshOllama();
  }, []);

  async function changeModel(model: string) {
    setSelectedModel(model);
    if (model) {
      await saveOllamaModel(model);
    }
  }

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">AI Platform</span>
          <h1>One reader, any model.</h1>
          <p>
            LexiPane separates reading tasks from model providers. Local
            Ollama is now executable from the desktop app; cloud and additional
            local runtimes continue through the provider architecture.
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
          Start Ollama before LexiPane. Installed models are discovered
          automatically; Qwen 3.5 is preferred when no model has been chosen.
        </small>
      </section>

      <div className="settings-grid">
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
            <button>Automatic</button>
            <button>Cloud only</button>
          </div>
        </section>

        <section className="settings-card">
          <span className="eyebrow">Task routing</span>
          <h2>Current first route</h2>
          <div className="route-list">
            <div><span>Selected text</span><strong>Ollama local</strong></div>
            <div><span>Grammar analysis</span><strong>Ollama local</strong></div>
            <div><span>Reader questions</span><strong>Ollama local</strong></div>
            <div><span>Region / vision</span><strong>Planned</strong></div>
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

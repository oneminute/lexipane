import { useEffect, useMemo, useState } from "react";
import {
  deleteProviderConfig,
  listProviderConfigModels,
  listProviderConfigs,
  saveProviderConfig,
  testProviderConfig,
  type ProviderConfig,
} from "../../core/ai/providerConfigs";
import { providerCatalog } from "../../core/ai/registry";
import type { ModelInfo } from "../../core/ai/types";

const configurableProviders = providerCatalog.filter(
  (provider) =>
    provider.adapter === "openai-compatible" ||
    provider.adapter === "anthropic-native" ||
    provider.adapter === "gemini-native",
);

interface FormState {
  id?: string;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function initialForm(): FormState {
  const provider =
    configurableProviders.find((item) => item.id === "openai") ??
    configurableProviders[0];

  return {
    providerId: provider?.id ?? "custom-cloud",
    displayName: provider?.name ?? "Custom provider",
    baseUrl: provider?.defaultBaseUrl ?? "",
    model: "",
    apiKey: "",
  };
}

interface Props {
  onChanged?: () => void | Promise<void>;
}

export function ProviderConnections({ onChanged }: Props) {
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const selectedDescriptor = useMemo(
    () =>
      configurableProviders.find(
        (provider) => provider.id === form.providerId,
      ),
    [form.providerId],
  );

  async function refreshConfigs() {
    setConfigs(await listProviderConfigs());
  }

  useEffect(() => {
    void refreshConfigs().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load provider connections.",
      );
    });
  }, []);

  function selectProvider(providerId: string) {
    const descriptor = configurableProviders.find(
      (provider) => provider.id === providerId,
    );

    setForm({
      providerId,
      displayName: descriptor?.name ?? providerId,
      baseUrl: descriptor?.defaultBaseUrl ?? "",
      model: "",
      apiKey: "",
    });
    setModels([]);
    setMessage("");
  }

  function editConfig(config: ProviderConfig) {
    setForm({
      id: config.id,
      providerId: config.providerId,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      model: config.settings.model ?? "",
      apiKey: "",
    });
    setModels([]);
    setMessage(
      config.hasApiKey
        ? "API key is stored securely. Leave the key field blank to keep it."
        : "",
    );
  }

  async function save() {
    setBusy(true);
    setMessage("");

    try {
      const saved = await saveProviderConfig({
        id: form.id,
        providerId: form.providerId,
        displayName: form.displayName,
        baseUrl: form.baseUrl,
        model: form.model,
        apiKey: form.apiKey || undefined,
      });

      setForm({
        id: saved.id,
        providerId: saved.providerId,
        displayName: saved.displayName,
        baseUrl: saved.baseUrl,
        model: saved.settings.model ?? "",
        apiKey: "",
      });
      setMessage(
        saved.hasApiKey
          ? "Saved. API key is in the OS credential store, not SQLite."
          : "Saved. This provider currently has no API key.",
      );
      await refreshConfigs();
      await onChanged?.();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save provider.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function test(config: ProviderConfig) {
    setTestingId(config.id);
    setMessage("");

    try {
      const result = await testProviderConfig(config.id);
      setMessage(
        (result.ok ? "Connected: " : "Connection failed: ") +
          result.message,
      );
    } finally {
      setTestingId(null);
    }
  }

  async function discoverModels(config: ProviderConfig) {
    setTestingId(config.id);
    setMessage("");

    try {
      const discovered = await listProviderConfigModels(config.id);
      setModels(discovered);
      editConfig(config);
      setModels(discovered);
      setMessage(
        discovered.length > 0
          ? discovered.length + " model(s) discovered."
          : "Connection worked but the provider returned no models.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to discover provider models.",
      );
    } finally {
      setTestingId(null);
    }
  }

  async function remove(config: ProviderConfig) {
    if (!window.confirm("Delete " + config.displayName + " configuration?")) {
      return;
    }

    await deleteProviderConfig(config.id);
    if (form.id === config.id) {
      setForm(initialForm());
      setModels([]);
    }
    await refreshConfigs();
    await onChanged?.();
    setMessage("Provider configuration and stored API key were deleted.");
  }

  return (
    <section className="provider-connections">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Connections</span>
          <h2>Local & cloud providers</h2>
        </div>
        <span>{configs.length} configured</span>
      </div>

      <div className="connection-layout">
        <section className="settings-card provider-editor">
          <div className="provider-editor-heading">
            <div>
              <span className="eyebrow">
                {form.id ? "Edit provider" : "Add provider"}
              </span>
              <h2>{selectedDescriptor?.name ?? "Provider"}</h2>
            </div>
            {form.id && (
              <button
                className="text-button"
                onClick={() => {
                  setForm(initialForm());
                  setModels([]);
                  setMessage("");
                }}
              >
                New
              </button>
            )}
          </div>

          <div className="provider-form-grid">
            <label>
              <span>Provider</span>
              <select
                value={form.providerId}
                onChange={(event) => selectProvider(event.target.value)}
              >
                {configurableProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Display name</span>
              <input
                value={form.displayName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
              />
            </label>

            <label className="wide">
              <span>Base URL</span>
              <input
                value={form.baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Model</span>
              {models.length > 0 ? (
                <select
                  value={form.model}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                >
                  <option value="">Choose a model</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.model}
                  placeholder="Model ID"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              )}
            </label>

            <label>
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                placeholder={
                  form.id ? "Leave blank to keep stored key" : "API key"
                }
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="provider-editor-actions">
            <button
              className="primary-button"
              disabled={busy || !form.baseUrl.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save provider"}
            </button>
            <span>
              API keys are stored in the operating system credential store.
            </span>
          </div>

          {message && <p className="provider-message">{message}</p>}
        </section>

        <section className="configured-provider-list">
          {configs.length === 0 ? (
            <div className="library-empty">
              <strong>No additional providers configured yet.</strong>
              <span>
                Ollama works independently. Add a provider here when
                you want another model source.
              </span>
            </div>
          ) : (
            configs.map((config) => (
              <article className="configured-provider-card" key={config.id}>
                <div>
                  <span className="provider-logo">
                    {providerCatalog.find(
                      (item) => item.id === config.providerId,
                    )?.shortLabel ?? "AI"}
                  </span>
                  <div>
                    <strong>{config.displayName}</strong>
                    <small>{config.baseUrl}</small>
                  </div>
                </div>

                <div className="configured-provider-meta">
                  <span className={config.hasApiKey ? "key-badge" : "key-badge missing"}>
                    {config.hasApiKey ? "Key secured" : "No key"}
                  </span>
                  {config.settings.model && (
                    <code>{config.settings.model}</code>
                  )}
                </div>

                <div className="configured-provider-actions">
                  <button onClick={() => editConfig(config)}>Edit</button>
                  <button
                    disabled={testingId === config.id}
                    onClick={() => void test(config)}
                  >
                    Test
                  </button>
                  <button
                    disabled={testingId === config.id}
                    onClick={() => void discoverModels(config)}
                  >
                    Models
                  </button>
                  <button
                    className="danger"
                    onClick={() => void remove(config)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </section>
  );
}

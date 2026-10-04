import { useEffect, useState } from "react";
import { ProviderConnections } from "./ProviderConnections";
import {
  defaultAiExecutionPolicy,
  loadAiExecutionPolicy,
  saveAiExecutionPolicy,
  type AiExecutionPolicy,
} from "../../core/ai/executionPolicy";
import { modelCapabilityLabels } from "../../core/ai/modelCapabilities";
import { testTextModel } from "../../core/ai/modelHealth";
import {
  choosePreferredOllamaModel,
  getOllamaBaseUrlCandidates,
  loadOllamaConfig,
  saveOllamaBaseUrl,
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
  loadTaskRoutePlan,
  saveTaskRoutePlan,
  type ReadingTaskType,
  type TaskRoutePlan,
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
type LlmTestStatus = "idle" | "testing" | "success" | "failure";

const emptyUsage: AiUsageSummary = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  averageLatencyMs: 0,
  estimatedCost: 0,
  estimatedCostToday: 0,
  estimatedCostThisMonth: 0,
  localRequests: 0,
  cloudRequests: 0,
};

const initialExecutionPolicies = Object.fromEntries(
  taskRoutes.map((task) => [
    task.id,
    defaultAiExecutionPolicy(task.id),
  ]),
) as Record<ReadingTaskType, AiExecutionPolicy>;

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

type OllamaProbeResult =
  | {
      ok: true;
      baseUrl: string;
      provider: OllamaProvider;
    }
  | {
      ok: false;
      message: string;
    };

async function probeOllama(
  preferredBaseUrl: string,
): Promise<OllamaProbeResult> {
  const failures: string[] = [];

  for (const baseUrl of getOllamaBaseUrlCandidates(preferredBaseUrl)) {
    const provider = new OllamaProvider(baseUrl);
    const connection = await provider.testConnection();

    if (connection.ok) {
      return {
        ok: true,
        baseUrl,
        provider,
      };
    }

    failures.push(baseUrl + " — " + connection.message);
  }

  return {
    ok: false,
    message:
      "Unable to connect to Ollama. Tried " +
      failures.join(" | "),
  };
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.details;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Use the fallback below.
    }
  }

  return "Unknown error.";
}

export function AiSettingsView() {
  const [ollamaStatus, setOllamaStatus] =
    useState<OllamaStatus>("checking");
  const [ollamaMessage, setOllamaMessage] = useState(
    "Checking local Ollama…",
  );
  const [serverUrl, setServerUrl] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [ollamaCapabilityLabels, setOllamaCapabilityLabels] =
    useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [llmTestStatus, setLlmTestStatus] =
    useState<LlmTestStatus>("idle");
  const [llmTestMessage, setLlmTestMessage] = useState("");
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>("B2");
  const [routePlans, setRoutePlans] =
    useState<Partial<Record<ReadingTaskType, TaskRoutePlan>>>({});
  const [providerConfigs, setProviderConfigs] =
    useState<ProviderConfig[]>([]);
  const [privacyMode, setPrivacyMode] =
    useState<AiPrivacyMode>("prefer-local");
  const [usage, setUsage] = useState<AiUsageSummary>(emptyUsage);
  const [executionPolicies, setExecutionPolicies] =
    useState<Record<ReadingTaskType, AiExecutionPolicy>>(
      initialExecutionPolicies,
    );
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
      ...taskRoutes.map((task) => loadTaskRoutePlan(task.id)),
    ]);

    setReadingLevel(level);
    setUsage(usageSummary);
    setPrivacyMode(privacy);
    setReadingProfile(profileSummary);
    setProviderConfigs(
      configuredProviders.filter((config) => config.enabled),
    );

    const nextPlans: Partial<
      Record<ReadingTaskType, TaskRoutePlan>
    > = {};
    taskRoutes.forEach((task, index) => {
      const value = routeValues[index] as TaskRoutePlan;
      nextPlans[task.id] = value;
    });
    setRoutePlans(nextPlans);

    const policies = await Promise.all(
      taskRoutes.map((task) => loadAiExecutionPolicy(task.id)),
    );
    setExecutionPolicies(
      Object.fromEntries(
        taskRoutes.map((task, index) => [
          task.id,
          policies[index],
        ]),
      ) as Record<ReadingTaskType, AiExecutionPolicy>,
    );
  }

  async function refreshOllama() {
    setRefreshing(true);
    setOllamaStatus("checking");
    setLlmTestStatus("idle");
    setLlmTestMessage("");
    setOllamaMessage("Checking local Ollama…");

    try {
      const config = await loadOllamaConfig();
      const requestedBaseUrl = serverUrl.trim() || config.baseUrl;
      const preferredBaseUrl =
        await saveOllamaBaseUrl(requestedBaseUrl);

      setServerUrl(preferredBaseUrl);

      const probe = await probeOllama(preferredBaseUrl);

      if (!probe.ok) {
        setModels([]);
        setSelectedModel("");
        setOllamaStatus("offline");
        setOllamaMessage(probe.message);
        return;
      }

      const discovered = await probe.provider.listModels();
      const preferred = choosePreferredOllamaModel(
        discovered,
        config.model,
      );

      setModels(discovered);
      setSelectedModel(preferred ?? "");
      setOllamaStatus("connected");

      if (preferred) {
        try {
          const capabilities =
            await probe.provider.getModelCapabilities(preferred);
          setOllamaCapabilityLabels(
            modelCapabilityLabels(capabilities),
          );
        } catch {
          setOllamaCapabilityLabels([]);
        }
      } else {
        setOllamaCapabilityLabels([]);
      }

      if (preferred && preferred !== config.model) {
        await saveOllamaModel(preferred);
      }

      const connectionLabel =
        probe.baseUrl === preferredBaseUrl
          ? "Connected at " + probe.baseUrl
          : "Preferred " +
            preferredBaseUrl +
            " unavailable · connected via fallback " +
            probe.baseUrl;

      setOllamaMessage(
        discovered.length > 0
          ? connectionLabel +
              " · " +
              discovered.length +
              " local model(s) discovered"
          : connectionLabel +
              ", but no local models are installed.",
      );
    } catch (error) {
      setModels([]);
      setSelectedModel("");
      setOllamaStatus("offline");
      setOllamaMessage(
        "Unable to connect to Ollama: " +
          describeUnknownError(error),
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
    setOllamaCapabilityLabels([]);
    setLlmTestStatus("idle");
    setLlmTestMessage("");

    if (model) {
      await saveOllamaModel(model);

      try {
        const config = await loadOllamaConfig();
        const probe = await probeOllama(config.baseUrl);

        if (!probe.ok) {
          throw new Error(probe.message);
        }

        const capabilities =
          await probe.provider.getModelCapabilities(model);
        setOllamaCapabilityLabels(
          modelCapabilityLabels(capabilities),
        );
      } catch {
        setOllamaCapabilityLabels([]);
      }
    }
  }

  async function testSelectedLlm() {
    if (llmTestStatus === "testing") return;

    setLlmTestStatus("testing");
    setLlmTestMessage("Checking Ollama and preparing a real inference request…");

    try {
      const config = await loadOllamaConfig();
      const requestedBaseUrl = serverUrl.trim() || config.baseUrl;
      const preferredBaseUrl =
        await saveOllamaBaseUrl(requestedBaseUrl);

      setServerUrl(preferredBaseUrl);

      const probe = await probeOllama(preferredBaseUrl);

      if (!probe.ok) {
        setModels([]);
        setSelectedModel("");
        setOllamaStatus("offline");
        setOllamaMessage(probe.message);
        setLlmTestStatus("failure");
        setLlmTestMessage(probe.message);
        return;
      }

      setOllamaStatus("connected");

      const discovered = await probe.provider.listModels();
      setModels(discovered);

      const selectedStillExists =
        selectedModel &&
        discovered.some((model) => model.id === selectedModel);
      const model = selectedStillExists
        ? selectedModel
        : choosePreferredOllamaModel(discovered, config.model);

      setSelectedModel(model ?? "");

      const connectionLabel =
        probe.baseUrl === preferredBaseUrl
          ? "Connected at " + probe.baseUrl
          : "Preferred " +
            preferredBaseUrl +
            " unavailable · connected via fallback " +
            probe.baseUrl;

      if (!model) {
        setOllamaMessage(
          connectionLabel +
            ", but no local models are installed.",
        );
        setLlmTestStatus("failure");
        setLlmTestMessage(
          "Ollama is reachable at " +
            probe.baseUrl +
            ", but it reported no installed models.",
        );
        return;
      }

      await saveOllamaModel(model);
      setOllamaMessage(
        connectionLabel +
          " · " +
          discovered.length +
          " local model(s) discovered",
      );
      setLlmTestMessage(
        'Sending a real inference request to "' + model + '"…',
      );

      const result = await testTextModel(probe.provider, model);

      setLlmTestStatus(result.ok ? "success" : "failure");
      setLlmTestMessage(
        result.responsePreview
          ? result.message + ' · Reply: "' + result.responsePreview + '"'
          : result.message,
      );
    } catch (error) {
      setLlmTestStatus("failure");
      setLlmTestMessage(
        "LLM inference failed: " +
          describeUnknownError(error),
      );
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
    slot: "primary" | 0 | 1,
    encoded: string,
  ) {
    const current = routePlans[task] ?? {
      primary: null,
      fallbacks: [],
    };
    const target = encoded ? decodeRoute(encoded) : null;

    if (slot === "primary" && !target) return;

    const implicitPrimary: TaskRouteTarget | null =
      current.primary ??
      (selectedModel
        ? {
            kind: "ollama",
            model: selectedModel,
          }
        : null);

    const nextFallbacks = [...current.fallbacks];

    if (slot === "primary") {
      const next: TaskRoutePlan = {
        primary: target,
        fallbacks: nextFallbacks,
      };
      setRoutePlans((plans) => ({ ...plans, [task]: next }));
      await saveTaskRoutePlan(task, next);
      return;
    }

    if (target) {
      nextFallbacks[slot] = target;
    } else {
      nextFallbacks.splice(slot, 1);
    }

    const next: TaskRoutePlan = {
      primary: implicitPrimary,
      fallbacks: nextFallbacks.filter(Boolean).slice(0, 2),
    };
    setRoutePlans((plans) => ({ ...plans, [task]: next }));
    await saveTaskRoutePlan(task, next);
  }

  async function changeExecutionPolicy(
    task: ReadingTaskType,
    patch: Partial<AiExecutionPolicy>,
  ) {
    const current =
      executionPolicies[task] ?? defaultAiExecutionPolicy(task);
    const next: AiExecutionPolicy = {
      ...current,
      ...patch,
    };

    setExecutionPolicies((policies) => ({
      ...policies,
      [task]: next,
    }));
    await saveAiExecutionPolicy(task, next);
  }

  function currentRouteValue(
    task: ReadingTaskType,
    slot: "primary" | 0 | 1,
  ): string {
    const plan = routePlans[task];

    const target =
      slot === "primary"
        ? plan?.primary
        : plan?.fallbacks[slot];

    if (target) {
      return encodeRoute(target);
    }

    if (slot !== "primary") return "";

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
            <input
              value={serverUrl}
              disabled={refreshing || llmTestStatus === "testing"}
              placeholder="http://127.0.0.1:12000"
              onChange={(event) => {
                setServerUrl(event.target.value);
                setLlmTestStatus("idle");
                setLlmTestMessage("");
              }}
            />
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

          <button
            className="primary-button compact"
            disabled={
              refreshing ||
              llmTestStatus === "testing"
            }
            onClick={() => void testSelectedLlm()}
          >
            {llmTestStatus === "testing" ? "Testing LLM…" : "Test LLM"}
          </button>
        </div>

        {llmTestMessage && (
          <div
            className={
              "llm-test-result " +
              (llmTestStatus === "success"
                ? "success"
                : llmTestStatus === "failure"
                  ? "failure"
                  : "testing")
            }
            role="status"
          >
            <strong>
              {llmTestStatus === "success"
                ? "✓ LLM ready"
                : llmTestStatus === "failure"
                  ? "✕ LLM test failed"
                  : "Testing selected model"}
            </strong>
            <span>{llmTestMessage}</span>
          </div>
        )}

        {ollamaCapabilityLabels.length > 0 && (
          <div className="capability-chips">
            {ollamaCapabilityLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        )}

        <small className="ollama-hint">
          Server is the preferred Ollama endpoint and is never overwritten by
          automatic fallback. If it is unavailable, LexiPane may temporarily
          use another known local Ollama port and reports that explicitly.
          Test LLM allows up to two minutes for a cold model load before timing
          out.
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
          <h2>Primary route + ordered fallbacks</h2>
          <p>
            Each task tries its primary model first, retries transient failures
            using its execution policy, then moves through Fallback 1 and
            Fallback 2. Privacy and per-book provider policy filter routes
            before any content is sent.
          </p>
          <div className="task-route-list">
            {taskRoutes.map((task) => {
              const clouds = cloudRouteOptions(task.id);
              const noRoutes =
                models.length === 0 && clouds.length === 0;

              const renderRouteOptions = () => (
                <>
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
                        const model = config.settings.model ?? "";
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
                </>
              );

              return (
                <div key={task.id} className="task-route-row fallback-route-row">
                  <span>
                    <strong>{task.label}</strong>
                    <small>{task.description}</small>
                  </span>

                  <div className="task-route-selects">
                    <label>
                      <span>Primary</span>
                      <select
                        value={currentRouteValue(task.id, "primary")}
                        disabled={noRoutes}
                        onChange={(event) =>
                          void changeTaskRoute(
                            task.id,
                            "primary",
                            event.target.value,
                          )
                        }
                      >
                        {noRoutes && (
                          <option value="">No model available</option>
                        )}
                        {renderRouteOptions()}
                      </select>
                    </label>

                    <label>
                      <span>Fallback 1</span>
                      <select
                        value={currentRouteValue(task.id, 0)}
                        disabled={noRoutes}
                        onChange={(event) =>
                          void changeTaskRoute(
                            task.id,
                            0,
                            event.target.value,
                          )
                        }
                      >
                        <option value="">None</option>
                        {renderRouteOptions()}
                      </select>
                    </label>

                    <label>
                      <span>Fallback 2</span>
                      <select
                        value={currentRouteValue(task.id, 1)}
                        disabled={noRoutes}
                        onChange={(event) =>
                          void changeTaskRoute(
                            task.id,
                            1,
                            event.target.value,
                          )
                        }
                      >
                        <option value="">None</option>
                        {renderRouteOptions()}
                      </select>
                    </label>
                  </div>

                  <div className="task-execution-policy">
                    <label>
                      <span>Timeout</span>
                      <select
                        value={executionPolicies[task.id]?.timeoutMs ?? 60000}
                        onChange={(event) =>
                          void changeExecutionPolicy(task.id, {
                            timeoutMs: Number(event.target.value),
                          })
                        }
                      >
                        <option value={15000}>15s</option>
                        <option value={30000}>30s</option>
                        <option value={60000}>60s</option>
                        <option value={75000}>75s</option>
                        <option value={90000}>90s</option>
                        <option value={120000}>120s</option>
                      </select>
                    </label>

                    <label>
                      <span>Retries</span>
                      <select
                        value={executionPolicies[task.id]?.retries ?? 0}
                        onChange={(event) =>
                          void changeExecutionPolicy(task.id, {
                            retries: Number(event.target.value),
                          })
                        }
                      >
                        <option value={0}>0</option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                    </label>
                  </div>
                </div>
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
          <span className="eyebrow">AI usage & estimated cost</span>
          <h2>{usage.requests.toLocaleString()} requests</h2>
          <p>
            Cost is estimated only when a configured cloud provider has
            per-million-token pricing. Ollama remains $0 API cost.
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
              <strong>{"$" + usage.estimatedCost.toFixed(4)}</strong>
              <span>estimated total</span>
            </div>
            <div>
              <strong>{"$" + usage.estimatedCostToday.toFixed(4)}</strong>
              <span>today</span>
            </div>
            <div>
              <strong>{"$" + usage.estimatedCostThisMonth.toFixed(4)}</strong>
              <span>this month</span>
            </div>
            <div>
              <strong>
                {usage.localRequests} / {usage.cloudRequests}
              </strong>
              <span>local / cloud</span>
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

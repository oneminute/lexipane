import { useEffect, useMemo, useState } from "react";
import { listProviderConfigs } from "../../core/ai/providerConfigs";
import {
  loadBookProviderPolicy,
  saveBookProviderPolicy,
  type BookProviderPolicy,
  type BookProviderPolicyMode,
} from "../../core/books/bookPrivacy";

interface ProviderOption {
  key: string;
  label: string;
  detail: string;
}

interface Props {
  bookPath: string;
  onChanged?: () => void;
}

const defaultPolicy: BookProviderPolicy = {
  mode: "all",
  providerKeys: [],
};

export function BookProviderPolicyControl({
  bookPath,
  onChanged,
}: Props) {
  const [policy, setPolicy] =
    useState<BookProviderPolicy>(defaultPolicy);
  const [providers, setProviders] = useState<ProviderOption[]>([
    {
      key: "ollama",
      label: "Ollama",
      detail: "Local",
    },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      loadBookProviderPolicy(bookPath),
      listProviderConfigs(),
    ])
      .then(([saved, configs]) => {
        if (cancelled) return;

        setPolicy(saved);
        setProviders([
          {
            key: "ollama",
            label: "Ollama",
            detail: "Local",
          },
          ...configs
            .filter((config) => config.enabled)
            .map((config) => ({
              key: "config:" + config.id,
              label: config.displayName,
              detail: config.settings.model || config.providerId,
            })),
        ]);
      })
      .catch((error) => {
        console.error("Unable to load book provider policy", error);
      });

    return () => {
      cancelled = true;
    };
  }, [bookPath]);

  const selected = useMemo(
    () => new Set(policy.providerKeys),
    [policy.providerKeys],
  );

  async function persist(next: BookProviderPolicy) {
    setPolicy(next);
    setSaving(true);

    try {
      await saveBookProviderPolicy(bookPath, next);
      onChanged?.();
    } catch (error) {
      console.error("Unable to save book provider policy", error);
    } finally {
      setSaving(false);
    }
  }

  function changeMode(mode: BookProviderPolicyMode) {
    void persist({
      mode,
      providerKeys:
        mode === "all" ? [] : policy.providerKeys,
    });
  }

  function toggleProvider(key: string) {
    const next = new Set(policy.providerKeys);

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    void persist({
      ...policy,
      providerKeys: Array.from(next),
    });
  }

  const summary =
    policy.mode === "all"
      ? "All providers"
      : policy.mode === "allow"
        ? "Allow only"
        : "Blocked";

  return (
    <details className="book-provider-policy">
      <summary>
        <span>Providers</span>
        <strong>{summary}</strong>
      </summary>

      <div className="book-provider-policy-panel">
        <label>
          <span>Policy</span>
          <select
            value={policy.mode}
            disabled={saving}
            onChange={(event) =>
              changeMode(event.target.value as BookProviderPolicyMode)
            }
          >
            <option value="all">All allowed by privacy mode</option>
            <option value="allow">Allow only selected</option>
            <option value="deny">Block selected</option>
          </select>
        </label>

        {policy.mode !== "all" && (
          <div className="book-provider-options">
            {providers.map((provider) => (
              <label key={provider.key}>
                <input
                  type="checkbox"
                  checked={selected.has(provider.key)}
                  disabled={saving}
                  onChange={() => toggleProvider(provider.key)}
                />
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.detail}</small>
                </span>
              </label>
            ))}
          </div>
        )}

        <small className="book-provider-policy-hint">
          Privacy mode is evaluated first. This policy then narrows the
          remaining providers before any book content is sent.
        </small>
      </div>
    </details>
  );
}

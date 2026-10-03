import { providerCatalog } from "../../core/ai/registry";

const groups = [
  { key: "local", label: "Local AI" },
  { key: "global", label: "Global cloud" },
  { key: "china", label: "China cloud" },
] as const;

export function AiSettingsView() {
  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">AI Platform</span>
          <h1>One reader, any model.</h1>
          <p>
            LexiPane separates reading tasks from model providers. Ollama and
            generic OpenAI-compatible APIs are the first executable adapters;
            native provider adapters can be added without changing reader UI.
          </p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <span className="eyebrow">Privacy mode</span>
          <h2>Prefer local</h2>
          <p>
            Use local models first. Cloud escalation must remain explicit when
            selected content would leave the device.
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
          <h2>Planned routing defaults</h2>
          <div className="route-list">
            <div><span>Vocabulary</span><strong>Local model</strong></div>
            <div><span>Phrase explanation</span><strong>Local model</strong></div>
            <div><span>Sentence analysis</span><strong>Local model</strong></div>
            <div><span>Region / vision</span><strong>Capability based</strong></div>
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
                        {provider.status === "core" ? "adapter ready" : "cataloged"}
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

import type { ReadingRequestDebug } from "../../core/ai/readingService";

interface Props {
  debug: ReadingRequestDebug;
  model?: string | null;
  source?: string | null;
  rawResponse?: string;
  cached?: boolean;
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

export function AiRequestDebugPanel({
  debug,
  model,
  source,
  rawResponse,
  cached = false,
}: Props) {
  const chatPrompt = debug.messages
    .map(
      (message) =>
        "[" + message.role.toUpperCase() + "]\n" + message.content,
    )
    .join("\n\n");

  const requestDetails = JSON.stringify(
    {
      taskType: debug.taskType,
      mode: debug.mode,
      source: source || undefined,
      model: model || undefined,
      responseFormat: debug.responseFormat,
      temperature: debug.temperature,
      thinking: debug.thinking,
      messages: debug.messages,
    },
    null,
    2,
  );

  return (
    <details className="ai-debug-panel">
      <summary>Prompt & raw response debug</summary>

      {cached && (
        <p className="ai-debug-note">
          This result came from cache. The prompt below is the prompt LexiPane
          would send for this request; no model call was made this time.
        </p>
      )}

      <div className="ai-debug-actions">
        <button type="button" onClick={() => copyText(chatPrompt)}>
          Copy chat prompt
        </button>
        <button type="button" onClick={() => copyText(requestDetails)}>
          Copy request JSON
        </button>
      </div>

      <section className="ai-debug-section">
        <span>Chat-test prompt</span>
        <pre>{chatPrompt}</pre>
      </section>

      <section className="ai-debug-section">
        <span>Request details</span>
        <pre>{requestDetails}</pre>
      </section>

      {rawResponse !== undefined && (
        <section className="ai-debug-section">
          <span>Raw model response</span>
          <pre>{rawResponse || "(empty response)"}</pre>
        </section>
      )}
    </details>
  );
}

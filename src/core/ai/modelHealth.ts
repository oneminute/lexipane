import { APP_DEFAULTS } from "../../config/appDefaults";
import type { AIProvider } from "./provider";

export interface ModelHealthResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
  responsePreview?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function testTextModel(
  provider: AIProvider,
  model: string,
  timeoutMs = APP_DEFAULTS.ai.healthCheck.timeoutMs,
): Promise<ModelHealthResult> {
  const trimmedModel = model.trim();

  if (!trimmedModel) {
    return {
      ok: false,
      model: "",
      latencyMs: 0,
      message: "Choose a model before testing the LLM.",
    };
  }

  const controller = new AbortController();
  const started = Date.now();
  const timer = globalThis.setTimeout(
    () => controller.abort(),
    Math.max(1_000, timeoutMs),
  );

  try {
    const response = await provider.generateText({
      model: trimmedModel,
      temperature: 0,
      signal: controller.signal,
      messages: [
        {
          role: "user",
          content:
            "LexiPane connection test. Reply with a short acknowledgement.",
        },
      ],
    });

    const text = response.text.trim();
    const latencyMs = Date.now() - started;

    if (!text) {
      return {
        ok: false,
        model: response.model || trimmedModel,
        latencyMs,
        message:
          "The LLM endpoint responded, but the selected model returned no text.",
      };
    }

    return {
      ok: true,
      model: response.model || trimmedModel,
      latencyMs,
      message:
        "LLM inference succeeded · " +
        (response.model || trimmedModel) +
        " · " +
        latencyMs.toLocaleString() +
        " ms",
      responsePreview: text.slice(0, 160),
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const timedOut =
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");

    return {
      ok: false,
      model: trimmedModel,
      latencyMs,
      message: timedOut
        ? "LLM inference timed out after " +
          Math.round(timeoutMs / 1000) +
          " seconds."
        : "LLM inference failed: " + errorMessage(error),
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

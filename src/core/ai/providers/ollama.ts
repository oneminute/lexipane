import { APP_DEFAULTS } from "../../../config/appDefaults";
import { appFetch } from "../../http/appFetch";
import type { AIProvider } from "../provider";
import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
  TextStreamEvent,
  VisionGenerationRequest,
} from "../types";

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

interface OllamaShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

const DEFAULT_OLLAMA_BASE_URL = APP_DEFAULTS.ai.ollama.baseUrl;

interface OllamaChatResponse {
  model: string;
  done?: boolean;
  message?: {
    role: string;
    content: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor = {
    id: "ollama",
    name: "Ollama",
    shortLabel: "OL",
    region: "local",
    adapter: "ollama",
    status: "core",
    description: "Local models through the Ollama HTTP API.",
    defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL,
  };

  private readonly baseUrl: string;

  constructor(baseUrl = DEFAULT_OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const response = await appFetch(this.baseUrl + "/api/tags");
      return response.ok
        ? { ok: true, message: "Connected to Ollama." }
        : {
            ok: false,
            message: "Ollama returned HTTP " + response.status + ".",
          };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to reach Ollama.",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await appFetch(this.baseUrl + "/api/tags");
    if (!response.ok) {
      throw new Error(
        "Unable to list Ollama models: HTTP " + response.status,
      );
    }

    const payload = (await response.json()) as OllamaTagsResponse;

    return (payload.models ?? []).map((model) => ({
      id: model.name,
      name: model.name,
      providerId: this.descriptor.id,
      local: true,
      capabilities: {
        text: true,
        streaming: true,
      },
      capabilitySource: "inferred",
    }));
  }

  private async showModel(model: string): Promise<OllamaShowResponse> {
    const response = await appFetch(this.baseUrl + "/api/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });

    if (!response.ok) {
      throw new Error(
        "Unable to inspect Ollama model capabilities: HTTP " +
          response.status,
      );
    }

    return (await response.json()) as OllamaShowResponse;
  }

  async getCapabilities(model: string): Promise<string[]> {
    return (await this.showModel(model)).capabilities ?? [];
  }

  async getModelCapabilities(
    model: string,
  ): Promise<ModelInfo["capabilities"]> {
    const payload = await this.showModel(model);
    const capabilities = payload.capabilities ?? [];

    const contextWindow = Object.entries(payload.model_info ?? {})
      .find(([key, value]) =>
        key.toLocaleLowerCase().includes("context_length") &&
        typeof value === "number"
      )?.[1];

    return {
      text: capabilities.length === 0 || capabilities.includes("completion"),
      vision: capabilities.includes("vision") || undefined,
      tools: capabilities.includes("tools") || undefined,
      structuredOutput: capabilities.includes("completion") || undefined,
      streaming: true,
      contextWindow:
        typeof contextWindow === "number" ? contextWindow : undefined,
    };
  }

  async generateVision(
    request: VisionGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const capabilities = await this.getCapabilities(request.model);
    if (!capabilities.includes("vision")) {
      throw new Error(
        'Ollama model "' +
          request.model +
          '" does not report vision capability.',
      );
    }

    const comma = request.imageDataUrl.indexOf(",");
    const base64 =
      comma >= 0
        ? request.imageDataUrl.slice(comma + 1)
        : request.imageDataUrl;

    const response = await appFetch(this.baseUrl + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [
          {
            role: "user",
            content: request.prompt,
            images: [base64],
          },
        ],
        options: {
          temperature: 0.2,
        },
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(
        "Ollama vision analysis failed: HTTP " + response.status,
      );
    }

    const payload = (await response.json()) as OllamaChatResponse;
    return {
      text: payload.message?.content ?? "",
      model: payload.model || request.model,
      usage: {
        inputTokens: payload.prompt_eval_count,
        outputTokens: payload.eval_count,
      },
    };
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const response = await appFetch(this.baseUrl + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: false,
        options:
          typeof request.temperature === "number"
            ? { temperature: request.temperature }
            : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(
        "Ollama generation failed: HTTP " + response.status,
      );
    }

    const payload = (await response.json()) as OllamaChatResponse;

    return {
      text: payload.message?.content ?? "",
      model: payload.model || request.model,
      usage: {
        inputTokens: payload.prompt_eval_count,
        outputTokens: payload.eval_count,
      },
    };
  }

  async *streamText(
    request: TextGenerationRequest,
  ): AsyncIterable<TextStreamEvent> {
    const response = await appFetch(this.baseUrl + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        options:
          typeof request.temperature === "number"
            ? { temperature: request.temperature }
            : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(
        "Ollama streaming failed: HTTP " + response.status,
      );
    }

    if (!response.body) {
      throw new Error("Ollama streaming response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const payload = JSON.parse(trimmed) as OllamaChatResponse;
          const delta = payload.message?.content ?? "";

          yield {
            delta: delta || undefined,
            model: payload.model || request.model,
            usage: payload.done
              ? {
                  inputTokens: payload.prompt_eval_count,
                  outputTokens: payload.eval_count,
                }
              : undefined,
            done: Boolean(payload.done),
          };
        }

        if (done) break;
      }

      if (buffer.trim()) {
        const payload = JSON.parse(buffer.trim()) as OllamaChatResponse;
        yield {
          delta: payload.message?.content || undefined,
          model: payload.model || request.model,
          usage: {
            inputTokens: payload.prompt_eval_count,
            outputTokens: payload.eval_count,
          },
          done: true,
        };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

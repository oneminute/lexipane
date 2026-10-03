import { appFetch } from "../../http/appFetch";
import type { AIProvider } from "../provider";
import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
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

interface OllamaChatResponse {
  model: string;
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
    defaultBaseUrl: "http://127.0.0.1:11434",
  };

  private readonly baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:11434") {
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
    }));
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
}

import type { AIProvider } from "../provider";
import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
} from "../types";

interface OpenAIModelList {
  data?: Array<{ id: string }>;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface OpenAICompatibleOptions {
  descriptor: ProviderDescriptor;
  baseUrl: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleOptions) {
    this.descriptor = options.descriptor;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey
        ? { Authorization: "Bearer " + this.apiKey }
        : {}),
      ...this.extraHeaders,
    };
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const response = await fetch(this.baseUrl + "/models", {
        headers: this.headers(),
      });

      return response.ok
        ? {
            ok: true,
            message: "Connected to " + this.descriptor.name + ".",
          }
        : {
            ok: false,
            message: "Provider returned HTTP " + response.status + ".",
          };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Connection failed.",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(this.baseUrl + "/models", {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error("Unable to list models: HTTP " + response.status);
    }

    const payload = (await response.json()) as OpenAIModelList;

    return (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.id,
      providerId: this.descriptor.id,
      local: this.descriptor.region === "local",
      capabilities: {
        text: true,
        streaming: true,
      },
    }));
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const response = await fetch(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error("Text generation failed: HTTP " + response.status);
    }

    const payload = (await response.json()) as OpenAIChatResponse;

    return {
      text: payload.choices?.[0]?.message?.content ?? "",
      model: payload.model || request.model,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  }
}

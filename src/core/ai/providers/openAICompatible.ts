import { appFetch } from "../../http/appFetch";
import { inferCompatibleModelCapabilities } from "../modelCapabilities";
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

interface OpenAIStreamChunk {
  model?: string;
  choices?: Array<{
    delta?: {
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
      const response = await appFetch(this.baseUrl + "/models", {
        headers: this.headers(),
      });

      return response.ok
        ? {
            ok: true,
            message: "Connected to " + this.descriptor.name + ".",
          }
        : {
            ok: false,
            message:
              this.descriptor.name +
              " returned HTTP " +
              response.status +
              ".",
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
    const response = await appFetch(this.baseUrl + "/models", {
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
      capabilities: inferCompatibleModelCapabilities(model.id),
      capabilitySource: "inferred",
    }));
  }

  async getModelCapabilities(
    model: string,
  ): Promise<ModelInfo["capabilities"]> {
    return inferCompatibleModelCapabilities(model);
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const response = await appFetch(this.baseUrl + "/chat/completions", {
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
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Text generation failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
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

  async generateVision(
    request: VisionGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const response = await appFetch(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: request.prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: request.imageDataUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Vision generation failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
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

  async *streamText(
    request: TextGenerationRequest,
  ): AsyncIterable<TextStreamEvent> {
    const response = await appFetch(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        stream: true,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Streaming generation failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    if (!response.body) {
      throw new Error("Streaming response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastModel = request.model;

    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLines = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          for (const data of dataLines) {
            if (!data) continue;
            if (data === "[DONE]") {
              yield {
                model: lastModel,
                done: true,
              };
              continue;
            }

            const payload = JSON.parse(data) as OpenAIStreamChunk;
            lastModel = payload.model || lastModel;
            const delta = payload.choices?.[0]?.delta?.content ?? "";

            yield {
              delta: delta || undefined,
              model: lastModel,
              usage: payload.usage
                ? {
                    inputTokens: payload.usage.prompt_tokens,
                    outputTokens: payload.usage.completion_tokens,
                  }
                : undefined,
            };
          }
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

import { appFetch } from "../../http/appFetch";
import type { AIProvider } from "../provider";
import type {
  AIMessage,
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
  TextStreamEvent,
  VisionGenerationRequest,
} from "../types";

interface GeminiModelsResponse {
  models?: Array<{
    name: string;
    displayName?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

interface GeminiGenerateResponse {
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export interface GeminiOptions {
  descriptor: ProviderDescriptor;
  baseUrl: string;
  apiKey?: string;
}

function normalizeModelPath(model: string): string {
  return model.startsWith("models/") ? model : "models/" + model;
}

function splitMessages(messages: AIMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

  return { system, contents };
}

function responseText(payload: GeminiGenerateResponse): string {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

export class GeminiProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: GeminiOptions) {
    this.descriptor = options.descriptor;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "x-goog-api-key": this.apiKey } : {}),
    };
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const response = await appFetch(this.baseUrl + "/models?pageSize=1", {
        headers: this.headers(),
      });

      return response.ok
        ? { ok: true, message: "Connected to Google Gemini." }
        : {
            ok: false,
            message: "Gemini returned HTTP " + response.status + ".",
          };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Gemini.",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await appFetch(this.baseUrl + "/models?pageSize=1000", {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(
        "Unable to list Gemini models: HTTP " + response.status,
      );
    }

    const payload = (await response.json()) as GeminiModelsResponse;

    return (payload.models ?? [])
      .filter((model) =>
        (model.supportedGenerationMethods ?? []).includes("generateContent"),
      )
      .map((model) => ({
        id: model.name,
        name: model.displayName || model.name.replace(/^models\//, ""),
        providerId: this.descriptor.id,
        local: false,
        capabilities: {
          text: true,
          vision: true,
          structuredOutput: true,
          streaming: true,
          contextWindow: model.inputTokenLimit,
        },
        capabilitySource: "provider",
      }));
  }

  async getModelCapabilities(
    model: string,
  ): Promise<ModelInfo["capabilities"]> {
    const models = await this.listModels();
    const normalized = normalizeModelPath(model);
    const found = models.find(
      (item) => normalizeModelPath(item.id) === normalized,
    );

    return found?.capabilities ?? {
      text: true,
      vision: true,
      structuredOutput: true,
      streaming: true,
    };
  }

  private requestBody(request: TextGenerationRequest) {
    const { system, contents } = splitMessages(request.messages);

    return {
      contents,
      systemInstruction: system
        ? {
            parts: [{ text: system }],
          }
        : undefined,
      generationConfig:
        typeof request.temperature === "number"
          ? { temperature: request.temperature }
          : undefined,
    };
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const model = normalizeModelPath(request.model);
    const response = await appFetch(
      this.baseUrl + "/" + model + ":generateContent",
      {
        method: "POST",
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify(this.requestBody(request)),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Gemini generation failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    const payload = (await response.json()) as GeminiGenerateResponse;

    return {
      text: responseText(payload),
      model: payload.modelVersion || request.model,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  async generateVision(
    request: VisionGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const match = request.imageDataUrl.match(
      /^data:([^;,]+);base64,(.+)$/s,
    );
    if (!match) {
      throw new Error("Gemini vision requires a base64 data URL.");
    }

    const model = normalizeModelPath(request.model);
    const response = await appFetch(
      this.baseUrl + "/" + model + ":generateContent",
      {
        method: "POST",
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: request.prompt },
                {
                  inlineData: {
                    mimeType: match[1],
                    data: match[2],
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Gemini vision failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    const payload = (await response.json()) as GeminiGenerateResponse;

    return {
      text: responseText(payload),
      model: payload.modelVersion || request.model,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  async *streamText(
    request: TextGenerationRequest,
  ): AsyncIterable<TextStreamEvent> {
    const model = normalizeModelPath(request.model);
    const response = await appFetch(
      this.baseUrl + "/" + model + ":streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify(this.requestBody(request)),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Gemini streaming failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    if (!response.body) {
      throw new Error("Gemini streaming response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastModel = request.model;
    let lastUsage:
      | {
          inputTokens?: number;
          outputTokens?: number;
        }
      | undefined;

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
            const payload = JSON.parse(data) as GeminiGenerateResponse;
            lastModel = payload.modelVersion || lastModel;

            if (payload.usageMetadata) {
              lastUsage = {
                inputTokens: payload.usageMetadata.promptTokenCount,
                outputTokens: payload.usageMetadata.candidatesTokenCount,
              };
            }

            const delta = responseText(payload);
            if (delta) {
              yield {
                delta,
                model: lastModel,
              };
            }
          }
        }

        if (done) break;
      }

      yield {
        model: lastModel,
        usage: lastUsage,
        done: true,
      };
    } finally {
      reader.releaseLock();
    }
  }
}

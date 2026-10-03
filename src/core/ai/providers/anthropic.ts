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
} from "../types";

interface AnthropicModelsResponse {
  data?: Array<{
    id: string;
    display_name?: string;
    max_input_tokens?: number | null;
    capabilities?: {
      image_input?: { supported?: boolean };
      structured_outputs?: { supported?: boolean };
    } | null;
  }>;
}

interface AnthropicMessageResponse {
  model?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamPayload {
  type?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  delta?: {
    type?: string;
    text?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface AnthropicOptions {
  descriptor: ProviderDescriptor;
  baseUrl: string;
  apiKey?: string;
}

function splitMessages(messages: AIMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  return { system, conversation };
}

export class AnthropicProvider implements AIProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: AnthropicOptions) {
    this.descriptor = options.descriptor;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
    };
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const response = await appFetch(this.baseUrl + "/models", {
        headers: this.headers(),
      });

      return response.ok
        ? { ok: true, message: "Connected to Anthropic Claude." }
        : {
            ok: false,
            message: "Anthropic returned HTTP " + response.status + ".",
          };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to connect to Anthropic.",
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await appFetch(this.baseUrl + "/models?limit=1000", {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(
        "Unable to list Anthropic models: HTTP " + response.status,
      );
    }

    const payload = (await response.json()) as AnthropicModelsResponse;

    return (payload.data ?? []).map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      providerId: this.descriptor.id,
      local: false,
      capabilities: {
        text: true,
        vision: Boolean(model.capabilities?.image_input?.supported),
        structuredOutput: Boolean(
          model.capabilities?.structured_outputs?.supported,
        ),
        streaming: true,
        contextWindow: model.max_input_tokens ?? undefined,
      },
    }));
  }

  private requestBody(
    request: TextGenerationRequest,
    stream: boolean,
  ) {
    const { system, conversation } = splitMessages(request.messages);

    return {
      model: request.model,
      max_tokens: 4096,
      messages: conversation,
      system: system || undefined,
      temperature: request.temperature,
      stream,
    };
  }

  async generateText(
    request: TextGenerationRequest,
  ): Promise<TextGenerationResponse> {
    const response = await appFetch(this.baseUrl + "/messages", {
      method: "POST",
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify(this.requestBody(request, false)),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Anthropic generation failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    const payload = (await response.json()) as AnthropicMessageResponse;
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return {
      text,
      model: payload.model || request.model,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }

  async *streamText(
    request: TextGenerationRequest,
  ): AsyncIterable<TextStreamEvent> {
    const response = await appFetch(this.baseUrl + "/messages", {
      method: "POST",
      headers: this.headers(),
      signal: request.signal,
      body: JSON.stringify(this.requestBody(request, true)),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        "Anthropic streaming failed: HTTP " +
          response.status +
          (detail ? " · " + detail.slice(0, 300) : ""),
      );
    }

    if (!response.body) {
      throw new Error("Anthropic streaming response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let model = request.model;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

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

            const payload = JSON.parse(data) as AnthropicStreamPayload;

            if (payload.message?.model) {
              model = payload.message.model;
            }
            if (typeof payload.message?.usage?.input_tokens === "number") {
              inputTokens = payload.message.usage.input_tokens;
            }
            if (typeof payload.usage?.output_tokens === "number") {
              outputTokens = payload.usage.output_tokens;
            }

            if (
              payload.type === "content_block_delta" &&
              payload.delta?.type === "text_delta" &&
              payload.delta.text
            ) {
              yield {
                delta: payload.delta.text,
                model,
              };
            }

            if (payload.type === "message_stop") {
              yield {
                model,
                usage: {
                  inputTokens,
                  outputTokens,
                },
                done: true,
              };
            }
          }
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

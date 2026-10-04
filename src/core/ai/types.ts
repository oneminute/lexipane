export type ProviderRegion = "local" | "global" | "china";

export type ProviderAdapterType =
  | "ollama"
  | "openai-compatible"
  | "anthropic-native"
  | "gemini-native"
  | "custom";

export type ProviderStatus = "core" | "cataloged";

export interface ProviderDescriptor {
  id: string;
  name: string;
  shortLabel: string;
  region: ProviderRegion;
  adapter: ProviderAdapterType;
  status: ProviderStatus;
  description: string;
  defaultBaseUrl?: string;
}

export interface ModelCapabilities {
  text: boolean;
  vision?: boolean;
  embeddings?: boolean;
  structuredOutput?: boolean;
  streaming?: boolean;
  tools?: boolean;
  contextWindow?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  local: boolean;
  capabilities: ModelCapabilities;
  capabilitySource?: "provider" | "probe" | "inferred";
}

export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface TextGenerationRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
}

export interface VisionGenerationRequest {
  model: string;
  prompt: string;
  imageDataUrl: string;
  signal?: AbortSignal;
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface TextGenerationResponse {
  text: string;
  model: string;
  usage?: AIUsage;
}

export interface TextStreamEvent {
  delta?: string;
  model?: string;
  usage?: AIUsage;
  done?: boolean;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

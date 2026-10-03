import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
  TextStreamEvent,
} from "./types";

export interface AIProvider {
  readonly descriptor: ProviderDescriptor;

  testConnection(): Promise<ConnectionResult>;
  listModels(): Promise<ModelInfo[]>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  streamText?(request: TextGenerationRequest): AsyncIterable<TextStreamEvent>;
}

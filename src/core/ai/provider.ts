import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
  TextStreamEvent,
  VisionGenerationRequest,
} from "./types";

export interface AIProvider {
  readonly descriptor: ProviderDescriptor;

  testConnection(): Promise<ConnectionResult>;
  listModels(): Promise<ModelInfo[]>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  streamText?(request: TextGenerationRequest): AsyncIterable<TextStreamEvent>;
  generateVision?(
    request: VisionGenerationRequest,
  ): Promise<TextGenerationResponse>;
}

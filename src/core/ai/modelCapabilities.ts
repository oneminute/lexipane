import type {
  ModelCapabilities,
  ModelInfo,
  ProviderDescriptor,
} from "./types";

export function inferCompatibleModelCapabilities(
  modelId: string,
): ModelCapabilities {
  const name = modelId.toLocaleLowerCase();

  const vision = /(^|[-_.])(vision|vl|llava)([-_.]|$)/.test(name) ||
    /gpt-4o|gpt-4\.1|gpt-5|gemma-3|pixtral|qwen[^/]*(vl|vision)/.test(name);

  return {
    text: true,
    vision: vision || undefined,
    streaming: true,
  };
}

export function modelCapabilityLabels(
  capabilities: ModelCapabilities,
): string[] {
  const labels = ["text"];

  if (capabilities.vision) labels.push("vision");
  if (capabilities.structuredOutput) labels.push("structured");
  if (capabilities.streaming) labels.push("streaming");
  if (capabilities.tools) labels.push("tools");
  if (capabilities.embeddings) labels.push("embeddings");
  if (capabilities.contextWindow) {
    labels.push(
      Math.round(capabilities.contextWindow / 1000) + "k context",
    );
  }

  return labels;
}

export async function findModelInfo(
  descriptor: ProviderDescriptor,
  models: ModelInfo[],
  modelId: string,
): Promise<ModelInfo> {
  const exact = models.find((model) => model.id === modelId);
  if (exact) return exact;

  return {
    id: modelId,
    name: modelId,
    providerId: descriptor.id,
    local: descriptor.region === "local",
    capabilities: inferCompatibleModelCapabilities(modelId),
    capabilitySource: "inferred",
  };
}

import { describe, expect, it } from "vitest";
import type { AIProvider } from "./provider";
import { testTextModel } from "./modelHealth";
import type {
  ConnectionResult,
  ModelInfo,
  ProviderDescriptor,
  TextGenerationRequest,
  TextGenerationResponse,
} from "./types";

function fakeProvider(
  generate: (
    request: TextGenerationRequest,
  ) => Promise<TextGenerationResponse>,
): AIProvider {
  const descriptor: ProviderDescriptor = {
    id: "test",
    name: "Test",
    shortLabel: "T",
    region: "local",
    adapter: "custom",
    status: "core",
    description: "Test provider",
  };

  return {
    descriptor,
    testConnection: async (): Promise<ConnectionResult> => ({
      ok: true,
      message: "ok",
    }),
    listModels: async (): Promise<ModelInfo[]> => [],
    generateText: generate,
  };
}

describe("LLM model health test", () => {
  it("reports successful inference only when model returns text", async () => {
    const result = await testTextModel(
      fakeProvider(async () => ({
        text: "OK",
        model: "qwen-test",
      })),
      "qwen-test",
      5_000,
    );

    expect(result.ok).toBe(true);
    expect(result.model).toBe("qwen-test");
    expect(result.responsePreview).toBe("OK");
  });

  it("rejects an empty model response", async () => {
    const result = await testTextModel(
      fakeProvider(async () => ({
        text: "   ",
        model: "empty-test",
      })),
      "empty-test",
      5_000,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("returned no text");
  });
});

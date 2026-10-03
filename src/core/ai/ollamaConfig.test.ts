import { describe, expect, it } from "vitest";
import { choosePreferredOllamaModel } from "./ollamaConfig";
import type { ModelInfo } from "./types";

function model(id: string): ModelInfo {
  return {
    id,
    name: id,
    providerId: "ollama",
    local: true,
    capabilities: { text: true },
  };
}

describe("choosePreferredOllamaModel", () => {
  it("keeps a configured model when it still exists", () => {
    expect(
      choosePreferredOllamaModel(
        [model("qwen3.5:9b"), model("llama:8b")],
        "llama:8b",
      ),
    ).toBe("llama:8b");
  });

  it("prefers Qwen 3.5, then Qwen, then the first available model", () => {
    expect(
      choosePreferredOllamaModel(
        [model("llama:8b"), model("qwen3.5:9b")],
        null,
      ),
    ).toBe("qwen3.5:9b");

    expect(
      choosePreferredOllamaModel(
        [model("llama:8b"), model("qwen2.5:7b")],
        null,
      ),
    ).toBe("qwen2.5:7b");

    expect(
      choosePreferredOllamaModel([model("llama:8b")], null),
    ).toBe("llama:8b");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeTaskRoutePlan } from "./taskRouting";

describe("normalizeTaskRoutePlan", () => {
  it("keeps a primary and ordered fallbacks", () => {
    expect(
      normalizeTaskRoutePlan({
        primary: { kind: "ollama", model: "qwen3.5:9b" },
        fallbacks: [
          {
            kind: "provider",
            configId: "cloud-1",
            model: "strong-model",
          },
        ],
      }),
    ).toEqual({
      primary: { kind: "ollama", model: "qwen3.5:9b" },
      fallbacks: [
        {
          kind: "provider",
          configId: "cloud-1",
          model: "strong-model",
        },
      ],
    });
  });

  it("drops malformed routes", () => {
    expect(
      normalizeTaskRoutePlan({
        primary: { kind: "ollama", model: "" },
        fallbacks: [{ kind: "provider", configId: "", model: "x" }],
      }),
    ).toBeNull();
  });
});

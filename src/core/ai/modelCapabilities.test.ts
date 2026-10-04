import { describe, expect, it } from "vitest";
import {
  inferCompatibleModelCapabilities,
  modelCapabilityLabels,
} from "./modelCapabilities";

describe("model capability helpers", () => {
  it("marks obvious vision model families", () => {
    expect(
      inferCompatibleModelCapabilities("qwen2.5-vl-7b").vision,
    ).toBe(true);
    expect(
      inferCompatibleModelCapabilities("gpt-4o-mini").vision,
    ).toBe(true);
  });

  it("labels context windows", () => {
    expect(
      modelCapabilityLabels({
        text: true,
        streaming: true,
        contextWindow: 128000,
      }),
    ).toContain("128k context");
  });
});

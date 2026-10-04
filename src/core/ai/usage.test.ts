import { describe, expect, it } from "vitest";
import { estimateAiCost } from "./usage";

describe("estimateAiCost", () => {
  it("estimates token cost from per-million pricing", () => {
    const cost = estimateAiCost(
      {
        inputTokens: 500_000,
        outputTokens: 250_000,
      },
      {
        inputCostPerMillion: 2,
        outputCostPerMillion: 8,
      },
    );

    expect(cost).toBeCloseTo(3);
  });

  it("returns null when pricing is unknown", () => {
    expect(
      estimateAiCost(
        { inputTokens: 1000, outputTokens: 1000 },
        undefined,
      ),
    ).toBeNull();
  });
});

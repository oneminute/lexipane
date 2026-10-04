import { describe, expect, it } from "vitest";
import {
  formatStructuredRegionAnalysis,
  parseStructuredRegionAnalysis,
} from "./readingStructured";

describe("structured region analysis", () => {
  it("parses a chart response", () => {
    const analysis = parseStructuredRegionAnalysis(
      JSON.stringify({
        kind: "region",
        contentType: "chart",
        summary: "图表显示销量持续上升。",
        extractedText: "2024 2025 2026",
        keyPoints: ["2026 年最高"],
        visualDetails: ["纵轴表示销量"],
      }),
    );

    expect(analysis.kind).toBe("region");
    expect(analysis.contentType).toBe("chart");
    expect(formatStructuredRegionAnalysis(analysis)).toContain("2026");
  });
});

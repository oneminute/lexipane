import { describe, expect, it } from "vitest";
import { parsePdfTextAnchor } from "./pdfAnnotations";

describe("parsePdfTextAnchor", () => {
  it("parses a versioned PDF text-range anchor", () => {
    const anchor = parsePdfTextAnchor(
      JSON.stringify({
        version: 1,
        kind: "pdf-text-range",
        page: 7,
        exact: "raise concerns about",
        prefix: "members ",
        suffix: " its implications",
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      }),
    );

    expect(anchor?.page).toBe(7);
    expect(anchor?.exact).toBe("raise concerns about");
    expect(anchor?.rects).toHaveLength(1);
  });

  it("rejects malformed anchors", () => {
    expect(parsePdfTextAnchor("nope")).toBeNull();
    expect(
      parsePdfTextAnchor(
        JSON.stringify({
          version: 1,
          kind: "pdf-text-range",
          page: 0,
          exact: "x",
          rects: [],
        }),
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./structured";

describe("structured JSON extraction", () => {
  it("parses fenced JSON", () => {
    expect(
      extractJsonObject([
        "```json",
        '{"kind":"grammar","meaning":"ok"}',
        "```",
      ].join("\n")),
    ).toEqual({
      kind: "grammar",
      meaning: "ok",
    });
  });

  it("extracts a JSON object from surrounding prose", () => {
    expect(
      extractJsonObject(
        'Here is the result: {"kind":"answer","answer":"yes"} Thanks.',
      ),
    ).toEqual({
      kind: "answer",
      answer: "yes",
    });
  });

  it("repairs trailing commas", () => {
    expect(
      extractJsonObject(
        '{"kind":"answer","answer":"yes","keyPoints":["a",],}',
      ),
    ).toEqual({
      kind: "answer",
      answer: "yes",
      keyPoints: ["a"],
    });
  });

  it("repairs literal newlines inside JSON strings", () => {
    expect(
      extractJsonObject(
        '{"kind":"answer","answer":"line one\nline two"}',
      ),
    ).toEqual({
      kind: "answer",
      answer: "line one\nline two",
    });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJsonObject("plain prose only")).toThrow(
      "The model did not return valid JSON.",
    );
  });
});

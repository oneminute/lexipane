import { describe, expect, it } from "vitest";
import {
  DEFAULT_OLLAMA_BASE_URL,
  normalizeOllamaBaseUrl,
} from "./ollamaConfig";

describe("Ollama base URL", () => {
  it("uses the application default for blank values", () => {
    expect(normalizeOllamaBaseUrl("")).toBe(DEFAULT_OLLAMA_BASE_URL);
  });

  it("adds http when a local host is entered without a scheme", () => {
    expect(normalizeOllamaBaseUrl("127.0.0.1:12000")).toBe(
      "http://127.0.0.1:12000",
    );
  });

  it("removes trailing slashes", () => {
    expect(normalizeOllamaBaseUrl("http://localhost:12000///")).toBe(
      "http://localhost:12000",
    );
  });
});

import { describe, expect, it } from "vitest";
import { APP_DEFAULTS } from "./appDefaults";

describe("application defaults", () => {
  it("keeps normal runtime settings out of environment files", () => {
    expect(APP_DEFAULTS.ai.ollama.baseUrl).toBe(
      "http://127.0.0.1:12000",
    );
    expect(APP_DEFAULTS.ai.ollama.discoveryBaseUrls).toContain(
      "http://127.0.0.1:11434",
    );
    expect(APP_DEFAULTS.ai.privacyMode).toBe("prefer-local");
    expect(APP_DEFAULTS.ai.healthCheck.timeoutMs).toBe(180_000);
    expect(APP_DEFAULTS.ai.execution.explain.timeoutMs).toBe(120_000);
    expect(APP_DEFAULTS.ai.execution.grammar.timeoutMs).toBe(180_000);
    expect(APP_DEFAULTS.ai.execution.ask.timeoutMs).toBe(180_000);
    expect(APP_DEFAULTS.reading.level).toBe("B2");
    expect(APP_DEFAULTS.reading.ai.sentencePrefetchCount).toBe(3);
    expect(APP_DEFAULTS.reading.ebook.fontScale).toBe(100);
    expect(APP_DEFAULTS.ocr.language).toBe("eng");
  });
});

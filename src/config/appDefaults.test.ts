import { describe, expect, it } from "vitest";
import { APP_DEFAULTS } from "./appDefaults";

describe("application defaults", () => {
  it("keeps normal runtime settings out of environment files", () => {
    expect(APP_DEFAULTS.ai.ollama.baseUrl).toBe(
      "http://127.0.0.1:11434",
    );
    expect(APP_DEFAULTS.ai.privacyMode).toBe("prefer-local");
    expect(APP_DEFAULTS.reading.level).toBe("B2");
    expect(APP_DEFAULTS.reading.ebook.fontScale).toBe(100);
    expect(APP_DEFAULTS.ocr.language).toBe("eng");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeBookProviderPolicy } from "./bookPrivacy";

describe("book provider policy", () => {
  it("deduplicates and preserves allow lists", () => {
    expect(
      normalizeBookProviderPolicy({
        mode: "allow",
        providerKeys: ["ollama", "ollama", "config:one"],
      }),
    ).toEqual({
      mode: "allow",
      providerKeys: ["ollama", "config:one"],
    });
  });

  it("clears provider keys when mode is all", () => {
    expect(
      normalizeBookProviderPolicy({
        mode: "all",
        providerKeys: ["config:one"],
      }),
    ).toEqual({
      mode: "all",
      providerKeys: [],
    });
  });
});

import { describe, expect, it } from "vitest";
import { providerCatalog } from "./registry";

describe("provider catalog", () => {
  it("uses unique provider ids", () => {
    const ids = providerCatalog.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships Ollama as a core local provider", () => {
    const ollama = providerCatalog.find((provider) => provider.id === "ollama");
    expect(ollama?.region).toBe("local");
    expect(ollama?.status).toBe("core");
    expect(ollama?.adapter).toBe("ollama");
  });

  it("contains global and China cloud catalogs", () => {
    expect(providerCatalog.some((provider) => provider.region === "global")).toBe(true);
    expect(providerCatalog.some((provider) => provider.region === "china")).toBe(true);
  });
});

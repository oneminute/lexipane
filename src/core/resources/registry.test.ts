import { describe, expect, it } from "vitest";
import {
  getResourceProvider,
  listResourceProviders,
  registerResourceProvider,
  resourceProviderSupports,
} from "./registry";

describe("resource provider registry", () => {
  it("contains provider contracts without enabling live networking", () => {
    const providers = listResourceProviders();

    expect(providers.some((item) => item.id === "bittorrent")).toBe(true);
    expect(providers.some((item) => item.id === "google-drive")).toBe(true);
    expect(providers.every((item) => item.live === false)).toBe(true);
  });

  it("queries declared capabilities", () => {
    expect(resourceProviderSupports("opds", "search")).toBe(true);
    expect(resourceProviderSupports("http", "authentication")).toBe(false);
  });

  it("can register another provider contract", () => {
    registerResourceProvider({
      id: "test-provider",
      name: "Test provider",
      kind: "catalog",
      description: "Unit test provider.",
      builtin: false,
      live: false,
      capabilities: { search: true },
    });

    expect(getResourceProvider("test-provider")?.name).toBe(
      "Test provider",
    );
  });
});

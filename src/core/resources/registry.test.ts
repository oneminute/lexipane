import { describe, expect, it } from "vitest";
import {
  getResourceProvider,
  listResourceProviders,
  registerResourceProvider,
  resourceProviderSupports,
} from "./registry";

describe("resource provider registry", () => {
  it("enables only the providers implemented by the current milestone", () => {
    const providers = listResourceProviders();

    expect(providers.some((item) => item.id === "bittorrent")).toBe(true);
    expect(providers.some((item) => item.id === "google-drive")).toBe(true);
    expect(getResourceProvider("http")?.live).toBe(true);
    expect(getResourceProvider("opds")?.live).toBe(true);
    expect(getResourceProvider("google-drive")?.live).toBe(true);
    expect(getResourceProvider("dropbox")?.live).toBe(true);
    expect(getResourceProvider("onedrive")?.live).toBe(true);
    expect(getResourceProvider("bittorrent")?.live).toBe(true);
    expect(getResourceProvider("ed2k")?.live).toBe(true);
    expect(getResourceProvider("webdav")?.live).toBe(true);
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

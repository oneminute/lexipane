import { describe, expect, it } from "vitest";
import { classifyResourceInput } from "./resolver";

describe("resource input resolver", () => {
  it("recognizes magnet links without starting network activity", () => {
    const result = classifyResourceInput(
      "magnet:?xt=urn:btih:0123456789abcdef",
    );

    expect(result.kind).toBe("magnet");
    expect(result.providerHint).toBe("bittorrent");
    expect(result.startsNetworkActivity).toBe(false);
  });

  it("recognizes ED2K links", () => {
    const result = classifyResourceInput(
      "ed2k://|file|example.epub|123|0123456789ABCDEF0123456789ABCDEF|/",
    );

    expect(result.kind).toBe("ed2k");
    expect(result.providerHint).toBe("ed2k");
  });

  it("recognizes common cloud share hosts", () => {
    expect(
      classifyResourceInput(
        "https://drive.google.com/file/d/abc/view",
      ).kind,
    ).toBe("google-drive");

    expect(
      classifyResourceInput(
        "https://www.dropbox.com/scl/fi/abc/book.epub",
      ).kind,
    ).toBe("dropbox");

    expect(
      classifyResourceInput("https://1drv.ms/u/s!abc").kind,
    ).toBe("onedrive");
  });

  it("recognizes OPDS and torrent URLs before generic HTTP", () => {
    expect(
      classifyResourceInput("https://books.example.test/opds/v2").kind,
    ).toBe("opds");

    expect(
      classifyResourceInput("https://example.test/book.torrent").kind,
    ).toBe("torrent");
  });

  it("leaves unknown text inert", () => {
    const result = classifyResourceInput("some search words");

    expect(result.kind).toBe("unknown");
    expect(result.startsNetworkActivity).toBe(false);
  });
});

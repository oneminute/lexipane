import { describe, expect, it } from "vitest";
import {
  isSupportedResourceBook,
  mimeTypeForResourceBook,
  stripSupportedBookExtension,
  supportedResourceBookFormat,
} from "./bookFormats";

describe("network resource book formats", () => {
  it("recognizes every Reader-supported extension", () => {
    expect(supportedResourceBookFormat("book.pdf")).toBe("pdf");
    expect(supportedResourceBookFormat("book.epub")).toBe("epub");
    expect(supportedResourceBookFormat("book.mobi")).toBe("mobi");
    expect(supportedResourceBookFormat("book.azw")).toBe("azw");
    expect(supportedResourceBookFormat("book.azw3")).toBe("azw3");
  });

  it("recognizes Kindle-family MIME types when URLs have no extension", () => {
    expect(
      supportedResourceBookFormat(
        "https://example.test/download",
        "application/x-mobipocket-ebook",
      ),
    ).toBe("mobi");
    expect(
      isSupportedResourceBook(
        "https://example.test/download",
        "application/vnd.amazon.ebook",
      ),
    ).toBe(true);
  });

  it("strips supported ebook extensions from display titles", () => {
    expect(stripSupportedBookExtension("History.AZW3")).toBe("History");
    expect(stripSupportedBookExtension("History.mobi")).toBe("History");
  });

  it("maps formats to useful MIME hints", () => {
    expect(mimeTypeForResourceBook("pdf")).toBe("application/pdf");
    expect(mimeTypeForResourceBook("mobi")).toBe(
      "application/x-mobipocket-ebook",
    );
    expect(mimeTypeForResourceBook("azw3")).toBe(
      "application/vnd.amazon.ebook",
    );
  });
});

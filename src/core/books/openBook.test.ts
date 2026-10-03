import { describe, expect, it } from "vitest";
import {
  getBookExtension,
  isPdfPath,
  isSupportedBookPath,
} from "./openBook";

describe("book path helpers", () => {
  it("normalizes common ebook extensions", () => {
    expect(getBookExtension("C:\\Books\\Example.PDF")).toBe("pdf");
    expect(getBookExtension("/books/example.epub")).toBe("epub");
  });

  it("recognizes supported formats", () => {
    expect(isSupportedBookPath("/books/a.pdf")).toBe(true);
    expect(isSupportedBookPath("/books/a.azw3")).toBe(true);
    expect(isSupportedBookPath("/books/a.txt")).toBe(false);
  });

  it("detects PDFs", () => {
    expect(isPdfPath("/books/a.PDF")).toBe(true);
    expect(isPdfPath("/books/a.epub")).toBe(false);
    expect(isPdfPath(null)).toBe(false);
  });
});

export type DocumentFormat = "pdf" | "epub" | "mobi" | "azw" | "azw3";

export interface DocumentMetadata {
  title?: string;
  author?: string;
  pageCount?: number;
}

export interface PdfLocation {
  kind: "pdf-page";
  page: number;
}

export type DocumentLocation = PdfLocation;

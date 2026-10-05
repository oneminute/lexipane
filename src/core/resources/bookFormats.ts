import {
  getBookExtension,
  SUPPORTED_BOOK_EXTENSIONS,
  type SupportedBookExtension,
} from "../books/openBook";

const SUPPORTED_MIME_TYPES: Array<{
  format: SupportedBookExtension;
  values: string[];
}> = [
  {
    format: "pdf",
    values: ["application/pdf"],
  },
  {
    format: "epub",
    values: ["application/epub+zip"],
  },
  {
    format: "mobi",
    values: [
      "application/x-mobipocket-ebook",
      "application/x-mobipocket",
      "application/mobipocket",
    ],
  },
  {
    format: "azw",
    values: [
      "application/vnd.amazon.ebook",
      "application/x-amazon-ebook",
    ],
  },
  {
    format: "azw3",
    values: [
      "application/vnd.amazon.ebook",
      "application/x-mobi8-ebook",
      "application/x-kf8-ebook",
    ],
  },
];

export function supportedResourceBookFormat(
  nameOrUrl: string,
  mimeType?: string,
): SupportedBookExtension | null {
  const extension = getBookExtension(nameOrUrl) as SupportedBookExtension;
  if (SUPPORTED_BOOK_EXTENSIONS.includes(extension)) {
    return extension;
  }

  const normalizedMime = mimeType?.toLowerCase().split(";")[0].trim();
  if (!normalizedMime) return null;

  return (
    SUPPORTED_MIME_TYPES.find((entry) =>
      entry.values.includes(normalizedMime),
    )?.format ?? null
  );
}

export function isSupportedResourceBook(
  nameOrUrl: string,
  mimeType?: string,
): boolean {
  return supportedResourceBookFormat(nameOrUrl, mimeType) !== null;
}

export function stripSupportedBookExtension(name: string): string {
  const format = supportedResourceBookFormat(name);
  if (!format) return name;

  const suffix = "." + format;
  return name.toLowerCase().endsWith(suffix)
    ? name.slice(0, -suffix.length)
    : name;
}

export function mimeTypeForResourceBook(
  format: SupportedBookExtension,
): string | undefined {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "epub":
      return "application/epub+zip";
    case "mobi":
      return "application/x-mobipocket-ebook";
    case "azw":
    case "azw3":
      return "application/vnd.amazon.ebook";
  }
}

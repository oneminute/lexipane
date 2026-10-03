import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const SUPPORTED_BOOK_EXTENSIONS = [
  "pdf",
  "epub",
  "mobi",
  "azw",
  "azw3",
] as const;

export type SupportedBookExtension = (typeof SUPPORTED_BOOK_EXTENSIONS)[number];

export function getBookExtension(path: string): string {
  const normalized = path.split("?")[0].split("#")[0];
  const name = normalized.split(/[\\/]/).pop() ?? normalized;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedBookPath(path: string): boolean {
  return SUPPORTED_BOOK_EXTENSIONS.includes(
    getBookExtension(path) as SupportedBookExtension,
  );
}

export function isPdfPath(path: string | null): boolean {
  return Boolean(path && getBookExtension(path) === "pdf");
}

export async function chooseBookFile(): Promise<string | null> {
  if (!isTauri()) {
    console.info("Native file picker is available when running inside Tauri.");
    return null;
  }

  const selected = await open({
    multiple: false,
    directory: false,
    title: "Open a book in LexiPane",
    filters: [
      {
        name: "Books",
        extensions: [...SUPPORTED_BOOK_EXTENSIONS],
      },
    ],
  });

  return typeof selected === "string" ? selected : null;
}

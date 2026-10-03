import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const SUPPORTED_BOOK_EXTENSIONS = [
  "pdf",
  "epub",
  "mobi",
  "azw",
  "azw3",
] as const;

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

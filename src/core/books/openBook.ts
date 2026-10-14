import { isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
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

export function isEpubPath(path: string | null): boolean {
  return Boolean(path && getBookExtension(path) === "epub");
}

export function isKindlePath(path: string | null): boolean {
  if (!path) return false;
  const extension = getBookExtension(path);
  return extension === "mobi" || extension === "azw" || extension === "azw3";
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

  if (typeof selected !== "string") return null;
  // Android document URIs are not durable library paths.
  if (!/Android/i.test(navigator.userAgent)) return selected;
  const extension = getBookExtension(selected);
  if (!SUPPORTED_BOOK_EXTENSIONS.includes(extension as SupportedBookExtension)) {
    throw new Error("The selected Android document has no supported filename extension.");
  }
  const dir = await join(await appDataDir(), "library");
  await mkdir(dir, { recursive: true });
  const target = await join(dir, crypto.randomUUID() + "." + extension);
  const bytes = await readFile(selected);
  await writeFile(target, bytes);
  return target;
}

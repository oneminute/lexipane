import { invoke, isTauri } from "@tauri-apps/api/core";

export interface BookFileStatus {
  path: string;
  exists: boolean;
}

export async function computeBookFileHash(
  path: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>("book_file_sha256", { path });
}

export async function checkBookFiles(
  paths: string[],
): Promise<BookFileStatus[]> {
  if (!isTauri() || paths.length === 0) return [];
  return invoke<BookFileStatus[]>("check_book_files", { paths });
}

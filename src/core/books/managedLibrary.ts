import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ManagedBookCopy {
  path: string;
  fileHash: string;
}

export async function copyBookToManagedLibrary(
  path: string,
): Promise<ManagedBookCopy> {
  if (!isTauri()) {
    throw new Error("Managed library copies require the desktop application.");
  }

  return invoke<ManagedBookCopy>("copy_book_to_managed_library", { path });
}

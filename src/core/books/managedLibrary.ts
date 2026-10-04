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


export interface ManagedCleanupResult {
  filesRemoved: number;
  bytesRemoved: number;
}

export async function deleteManagedBookCopy(
  path: string,
): Promise<boolean> {
  if (!isTauri()) return false;

  return invoke<boolean>("delete_managed_book_copy", { path });
}

export async function cleanupManagedLibrary(
  keepPaths: string[],
): Promise<ManagedCleanupResult> {
  if (!isTauri()) {
    return {
      filesRemoved: 0,
      bytesRemoved: 0,
    };
  }

  return invoke<ManagedCleanupResult>("cleanup_managed_library", {
    keepPaths,
  });
}

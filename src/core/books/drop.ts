import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { isSupportedBookPath } from "./openBook";

export async function listenForBookDrops(
  onBookPath: (path: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }

  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;

    const path = event.payload.paths.find(isSupportedBookPath);
    if (path) {
      onBookPath(path);
    }
  });
}

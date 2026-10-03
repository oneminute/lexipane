import { readFile } from "@tauri-apps/plugin-fs";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfPasswordProvider = (
  reason: number,
) => Promise<string | null>;

export interface LoadedPdfDocument {
  document: PDFDocumentProxy;
  destroy(): Promise<void>;
}

export async function loadPdfFromPath(
  path: string,
  passwordProvider?: PdfPasswordProvider,
): Promise<LoadedPdfDocument> {
  const bytes = await readFile(path);
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    data: bytes,
  });

  let cancelledPassword = false;

  if (passwordProvider) {
    loadingTask.onPassword = (updatePassword, reason) => {
      void passwordProvider(reason)
        .then((password) => {
          if (password === null) {
            cancelledPassword = true;
            void loadingTask.destroy();
            return;
          }

          updatePassword(password);
        })
        .catch(() => {
          cancelledPassword = true;
          void loadingTask.destroy();
        });
    };
  }

  let document: PDFDocumentProxy;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    if (cancelledPassword) {
      throw new Error("PDF password entry was cancelled.");
    }
    throw error;
  }

  return {
    document,
    async destroy() {
      await loadingTask.destroy();
    },
  };
}

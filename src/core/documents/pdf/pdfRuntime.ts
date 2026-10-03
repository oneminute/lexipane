import { readFile } from "@tauri-apps/plugin-fs";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface LoadedPdfDocument {
  document: PDFDocumentProxy;
  destroy(): Promise<void>;
}

export async function loadPdfFromPath(path: string): Promise<LoadedPdfDocument> {
  const bytes = await readFile(path);
  const loadingTask: PDFDocumentLoadingTask = getDocument({
    data: bytes,
  });
  const document = await loadingTask.promise;

  return {
    document,
    async destroy() {
      await loadingTask.destroy();
    },
  };
}

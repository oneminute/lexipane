import { readFile } from "@tauri-apps/plugin-fs";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function loadPdfFromPath(path: string): Promise<PDFDocumentProxy> {
  const bytes = await readFile(path);
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
  });

  return loadingTask.promise;
}

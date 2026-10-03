import { readFile } from "@tauri-apps/plugin-fs";
import {
  GlobalWorkerOptions,
  TextLayerImages,
  getDocument,
  type PDFDocumentProxy,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface LoadedPdfDocument {
  document: PDFDocumentProxy;
  createEmptyTextLayerImages(
    viewport: ConstructorParameters<typeof TextLayerImages>[2],
    canvas: HTMLCanvasElement,
  ): TextLayerImages;
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
    createEmptyTextLayerImages(viewport, canvas) {
      return new TextLayerImages(
        0,
        new Float32Array(0),
        viewport,
        () => canvas,
      );
    },
    async destroy() {
      await loadingTask.destroy();
    },
  };
}

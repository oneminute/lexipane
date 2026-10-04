import { invoke, isTauri } from "@tauri-apps/api/core";
import { APP_DEFAULTS } from "../../config/appDefaults";

export interface LocalOcrStatus {
  available: boolean;
  engine: string;
  executable?: string | null;
  message: string;
}

export interface LocalOcrResult {
  text: string;
  engine: string;
  language: string;
}

function imageBytesFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error("OCR requires a base64 image data URL.");
  }

  const metadata = dataUrl.slice(0, comma);
  if (!metadata.includes(";base64")) {
    throw new Error("OCR image data URL is not base64 encoded.");
  }

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function getLocalOcrStatus(): Promise<LocalOcrStatus> {
  if (!isTauri()) {
    return {
      available: false,
      engine: "Tesseract OCR",
      executable: null,
      message: "Local OCR is available in the desktop application.",
    };
  }

  return invoke<LocalOcrStatus>("local_ocr_status");
}

export async function recognizeImageDataUrl(
  imageDataUrl: string,
  language = APP_DEFAULTS.ocr.language,
): Promise<LocalOcrResult> {
  if (!isTauri()) {
    throw new Error("Local OCR requires the desktop application.");
  }

  const bytes = imageBytesFromDataUrl(imageDataUrl);

  return invoke<LocalOcrResult>("ocr_image", {
    imageBytes: Array.from(bytes),
    language,
  });
}

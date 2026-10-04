import { invoke, isTauri } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { initializeDatabase } from "../db/database";

export interface NoteAsset {
  id: string;
  note_id: string;
  kind: "image";
  mime_type: string;
  file_path: string;
  file_hash: string;
  created_at: string;
}

interface StoredNoteAsset {
  path: string;
  fileHash: string;
  mimeType: string;
}

function parseImageDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: number[];
} {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s);
  if (!match) {
    throw new Error("Notebook attachment must be a supported base64 image.");
  }

  const binary = atob(match[2]);
  const bytes = new Array<number>(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    mimeType: match[1],
    bytes,
  };
}

function bytesToDataUrl(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Unable to load notebook attachment."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to decode notebook attachment."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(new Blob([copy], { type: mimeType }));
  });
}

export async function createNoteImageAsset(
  noteId: string,
  imageDataUrl: string,
): Promise<NoteAsset | null> {
  if (!isTauri()) return null;

  const parsed = parseImageDataUrl(imageDataUrl);
  const stored = await invoke<StoredNoteAsset>("save_note_asset", {
    imageBytes: parsed.bytes,
    mimeType: parsed.mimeType,
  });

  const db = await initializeDatabase();
  if (!db) return null;

  const existing = await db.select<NoteAsset[]>(
    "SELECT id, note_id, kind, mime_type, file_path, file_hash, created_at " +
      "FROM note_assets WHERE note_id = $1 AND file_hash = $2 LIMIT 1",
    [noteId, stored.fileHash],
  );

  if (existing[0]) return existing[0];

  const asset: NoteAsset = {
    id: crypto.randomUUID(),
    note_id: noteId,
    kind: "image",
    mime_type: stored.mimeType,
    file_path: stored.path,
    file_hash: stored.fileHash,
    created_at: new Date().toISOString(),
  };

  await db.execute(
    "INSERT INTO note_assets " +
      "(id, note_id, kind, mime_type, file_path, file_hash, created_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      asset.id,
      asset.note_id,
      asset.kind,
      asset.mime_type,
      asset.file_path,
      asset.file_hash,
      asset.created_at,
    ],
  );

  return asset;
}

export async function listNoteAssets(): Promise<NoteAsset[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<NoteAsset[]>(
    "SELECT id, note_id, kind, mime_type, file_path, file_hash, created_at " +
      "FROM note_assets ORDER BY created_at ASC",
  );
}

export async function loadNoteAssetDataUrl(
  asset: NoteAsset,
): Promise<string> {
  const bytes = await readFile(asset.file_path);
  return bytesToDataUrl(bytes, asset.mime_type);
}

export async function deleteUnreferencedNoteAssetFiles(
  paths: string[],
): Promise<void> {
  if (!isTauri() || paths.length === 0) return;

  const db = await initializeDatabase();
  if (!db) return;

  for (const path of Array.from(new Set(paths))) {
    const rows = await db.select<Array<{ count: number }>>(
      "SELECT COUNT(*) AS count FROM note_assets WHERE file_path = $1",
      [path],
    );

    if (Number(rows[0]?.count ?? 0) > 0) continue;

    await invoke<boolean>("delete_note_asset", { path }).catch((error) => {
      console.warn("Unable to delete orphan notebook asset", path, error);
      return false;
    });
  }
}

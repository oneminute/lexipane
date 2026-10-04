import { isTauri } from "@tauri-apps/api/core";
import { initializeDatabase } from "../db/database";
import { computeBookFileHash } from "./fileIdentity";
import {
  cleanupManagedLibrary as cleanupManagedFiles,
  copyBookToManagedLibrary,
  deleteManagedBookCopy,
  type ManagedCleanupResult,
} from "./managedLibrary";
import { getBookExtension } from "./openBook";

export type BookReadingStatus = "reading" | "finished";

export interface LibraryBook {
  id: string;
  file_path: string;
  file_hash: string | null;
  format: string;
  title: string | null;
  author: string | null;
  cover_path: string | null;
  favorite: number;
  reading_status: BookReadingStatus;
  managed_copy: number;
  progress: number | null;
  added_at: string;
  last_opened_at: string | null;
}

function titleFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop() || path;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

const BOOK_SELECT =
  "SELECT b.id, b.file_path, b.file_hash, b.format, b.title, b.author, b.cover_path, " +
  "b.favorite, b.reading_status, b.managed_copy, rp.progress, b.added_at, b.last_opened_at " +
  "FROM books b LEFT JOIN reading_positions rp ON rp.book_id = b.id ";

async function hashBookFile(path: string): Promise<string | null> {
  try {
    return await computeBookFileHash(path);
  } catch (error) {
    console.warn("Unable to compute book content hash", error);
    return null;
  }
}

export async function registerBookFile(path: string): Promise<LibraryBook | null> {
  if (!isTauri()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const now = new Date().toISOString();
  const format = getBookExtension(path) || "unknown";
  const title = titleFromPath(path);

  const existingPath = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.file_path = $1 LIMIT 1",
    [path],
  );

  if (existingPath[0]) {
    const fileHash =
      existingPath[0].file_hash || (await hashBookFile(path));

    await db.execute(
      "UPDATE books SET format = $2, file_hash = COALESCE(file_hash, $3), " +
        "last_opened_at = $4 WHERE id = $1",
      [existingPath[0].id, format, fileHash, now],
    );

    const rows = await db.select<LibraryBook[]>(
      BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
      [existingPath[0].id],
    );

    return rows[0] ?? null;
  }

  const fileHash = await hashBookFile(path);

  if (fileHash) {
    const existingHash = await db.select<LibraryBook[]>(
      BOOK_SELECT + "WHERE b.file_hash = $1 LIMIT 1",
      [fileHash],
    );

    if (existingHash[0]) {
      if (existingHash[0].managed_copy === 1) {
        await db.execute(
          "UPDATE books SET last_opened_at = $2 WHERE id = $1",
          [existingHash[0].id, now],
        );
      } else {
        await db.execute(
          "UPDATE books SET file_path = $2, format = $3, " +
            "title = CASE WHEN title IS NULL OR TRIM(title) = '' THEN $4 ELSE title END, " +
            "last_opened_at = $5 WHERE id = $1",
          [existingHash[0].id, path, format, title, now],
        );
      }

      const rows = await db.select<LibraryBook[]>(
        BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
        [existingHash[0].id],
      );

      return rows[0] ?? null;
    }
  }

  const id = crypto.randomUUID();

  await db.execute(
    "INSERT INTO books " +
      "(id, file_path, file_hash, format, title, added_at, last_opened_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $6)",
    [id, path, fileHash, format, title, now],
  );

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [id],
  );

  return rows[0] ?? null;
}

export async function relinkLibraryBook(
  bookId: string,
  path: string,
): Promise<LibraryBook> {
  if (!isTauri()) {
    throw new Error("Relinking books requires the desktop application.");
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable.");
  }

  const existing = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );
  const book = existing[0];

  if (!book) {
    throw new Error("The library book no longer exists.");
  }

  if (book.managed_copy === 1 && path === book.file_path) {
    throw new Error(
      "Choose an external copy of this book, not the LexiPane-managed file itself.",
    );
  }

  const previousManagedPath =
    book.managed_copy === 1 ? book.file_path : null;

  const fileHash = await computeBookFileHash(path);
  if (!fileHash) {
    throw new Error("Unable to identify the selected book file.");
  }

  if (book.file_hash && book.file_hash !== fileHash) {
    throw new Error(
      "The selected file has different content. Choose the moved or renamed copy of the same book.",
    );
  }

  const conflict = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.file_path = $1 AND b.id <> $2 LIMIT 1",
    [path, bookId],
  );

  if (conflict[0]) {
    throw new Error("That file is already linked to another library entry.");
  }

  await db.execute(
    "UPDATE books SET file_path = $2, file_hash = $3, format = $4, " +
      "managed_copy = 0, last_opened_at = $5 WHERE id = $1",
    [
      bookId,
      path,
      fileHash,
      getBookExtension(path) || book.format,
      new Date().toISOString(),
    ],
  );

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );

  if (!rows[0]) {
    throw new Error("Relinked book could not be reloaded.");
  }

  if (previousManagedPath) {
    await deleteManagedBookCopy(previousManagedPath).catch((error) => {
      console.warn(
        "Book was relinked, but the old managed copy could not be deleted",
        error,
      );
    });
  }

  return rows[0];
}

export async function restoreMissingLibraryBookToManagedStorage(
  bookId: string,
  sourcePath: string,
): Promise<LibraryBook> {
  if (!isTauri()) {
    throw new Error("Restoring books requires the desktop application.");
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable.");
  }

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );
  const book = rows[0];

  if (!book) {
    throw new Error("The library book no longer exists.");
  }

  const fileHash = await computeBookFileHash(sourcePath);
  if (!fileHash) {
    throw new Error("Unable to identify the replacement book file.");
  }

  if (book.file_hash && book.file_hash !== fileHash) {
    throw new Error(
      "The acquired file does not match the missing library book.",
    );
  }

  const managed = await copyBookToManagedLibrary(sourcePath);

  const conflict = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.file_path = $1 AND b.id <> $2 LIMIT 1",
    [managed.path, bookId],
  );

  if (conflict[0]) {
    throw new Error(
      "The managed replacement is already linked to another library entry.",
    );
  }

  const previousManagedPath =
    book.managed_copy === 1 ? book.file_path : null;

  await db.execute(
    "UPDATE books SET file_path = $2, file_hash = $3, format = $4, " +
      "managed_copy = 1, last_opened_at = $5 WHERE id = $1",
    [
      bookId,
      managed.path,
      managed.fileHash,
      getBookExtension(managed.path) || book.format,
      new Date().toISOString(),
    ],
  );

  if (
    previousManagedPath &&
    previousManagedPath !== managed.path
  ) {
    await deleteManagedBookCopy(previousManagedPath).catch((error) => {
      console.warn(
        "Book was restored, but the old missing managed path could not be cleaned",
        error,
      );
    });
  }

  const updated = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );

  if (!updated[0]) {
    throw new Error("Restored book could not be reloaded.");
  }

  return updated[0];
}

export async function copyLibraryBookToManagedStorage(
  bookId: string,
): Promise<LibraryBook> {
  if (!isTauri()) {
    throw new Error("Managed library copies require the desktop application.");
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable.");
  }

  const current = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );
  const book = current[0];

  if (!book) {
    throw new Error("The library book no longer exists.");
  }

  if (book.managed_copy === 1) {
    return book;
  }

  const managed = await copyBookToManagedLibrary(book.file_path);

  const conflict = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.file_path = $1 AND b.id <> $2 LIMIT 1",
    [managed.path, bookId],
  );

  if (conflict[0]) {
    throw new Error(
      "A managed copy of this book is already linked to another library entry.",
    );
  }

  await db.execute(
    "UPDATE books SET file_path = $2, file_hash = $3, managed_copy = 1, " +
      "last_opened_at = $4 WHERE id = $1",
    [bookId, managed.path, managed.fileHash, new Date().toISOString()],
  );

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.id = $1 LIMIT 1",
    [bookId],
  );

  if (!rows[0]) {
    throw new Error("Managed library copy could not be reloaded.");
  }

  return rows[0];
}

export async function backfillLibraryBookHashes(
  limit = 2,
): Promise<number> {
  if (!isTauri() || limit <= 0) return 0;

  const db = await initializeDatabase();
  if (!db) return 0;

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT +
      "WHERE b.file_hash IS NULL ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC LIMIT $1",
    [Math.max(1, Math.min(20, Math.round(limit)))],
  );

  let updated = 0;

  for (const book of rows) {
    const fileHash = await hashBookFile(book.file_path);
    if (!fileHash) continue;

    await db.execute(
      "UPDATE books SET file_hash = $2 WHERE id = $1 AND file_hash IS NULL",
      [book.id, fileHash],
    );
    updated += 1;
  }

  return updated;
}

export async function cleanupManagedLibraryStorage(): Promise<ManagedCleanupResult> {
  if (!isTauri()) {
    return {
      filesRemoved: 0,
      bytesRemoved: 0,
    };
  }

  const db = await initializeDatabase();
  if (!db) {
    throw new Error("Database is unavailable.");
  }

  const rows = await db.select<Array<{ file_path: string }>>(
    "SELECT file_path FROM books WHERE managed_copy = 1",
  );

  return cleanupManagedFiles(rows.map((row) => row.file_path));
}

export async function findLibraryBookByHash(
  fileHash: string,
): Promise<LibraryBook | null> {
  if (!isTauri() || !fileHash.trim()) return null;

  const db = await initializeDatabase();
  if (!db) return null;

  const rows = await db.select<LibraryBook[]>(
    BOOK_SELECT + "WHERE b.file_hash = $1 LIMIT 1",
    [fileHash.trim().toLowerCase()],
  );

  return rows[0] ?? null;
}

export async function listLibraryBooks(): Promise<LibraryBook[]> {
  if (!isTauri()) return [];

  const db = await initializeDatabase();
  if (!db) return [];

  return db.select<LibraryBook[]>(
    BOOK_SELECT +
      "ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC",
  );
}

export async function updateBookMetadata(
  path: string,
  title: string | null,
  author: string | null,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET " +
      "title = CASE WHEN $2 IS NOT NULL AND TRIM($2) <> '' THEN $2 ELSE title END, " +
      "author = CASE WHEN $3 IS NOT NULL AND TRIM($3) <> '' THEN $3 ELSE author END " +
      "WHERE file_path = $1",
    [path, title, author],
  );
}

export async function updateBookCover(
  path: string,
  coverDataUrl: string | null,
): Promise<void> {
  if (!isTauri() || !coverDataUrl) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET cover_path = $2 WHERE file_path = $1",
    [path, coverDataUrl],
  );
}

export async function setBookFavorite(
  bookId: string,
  favorite: boolean,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET favorite = $2 WHERE id = $1",
    [bookId, favorite ? 1 : 0],
  );
}

export async function setBookReadingStatus(
  bookId: string,
  status: BookReadingStatus,
): Promise<void> {
  if (!isTauri()) return;

  const db = await initializeDatabase();
  if (!db) return;

  await db.execute(
    "UPDATE books SET reading_status = $2 WHERE id = $1",
    [bookId, status],
  );
}

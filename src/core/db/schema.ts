export const SCHEMA_VERSION = 9;

export const schemaStatements = [
  "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, file_path TEXT NOT NULL UNIQUE, file_hash TEXT, format TEXT NOT NULL, title TEXT, author TEXT, cover_path TEXT, favorite INTEGER NOT NULL DEFAULT 0, reading_status TEXT NOT NULL DEFAULT 'reading', privacy_mode TEXT, provider_policy_json TEXT, managed_copy INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, last_opened_at TEXT)",
  "CREATE TABLE IF NOT EXISTS reading_positions (book_id TEXT PRIMARY KEY, locator_json TEXT NOT NULL, progress REAL, updated_at TEXT NOT NULL, FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, locator_json TEXT NOT NULL, progress REAL, label TEXT, created_at TEXT NOT NULL, FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id)",
  "CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, source TEXT NOT NULL, type TEXT NOT NULL, anchor_json TEXT NOT NULL, selected_text TEXT, status TEXT NOT NULL DEFAULT 'active', color TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id)",
  "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, book_id TEXT, annotation_id TEXT, source_text TEXT, ai_content TEXT, user_content TEXT, tags_json TEXT NOT NULL DEFAULT '[]', anchor_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE, FOREIGN KEY(annotation_id) REFERENCES annotations(id) ON DELETE SET NULL)",
  "CREATE TABLE IF NOT EXISTS note_assets (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL, file_path TEXT NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_note_assets_note ON note_assets(note_id)",
  "CREATE INDEX IF NOT EXISTS idx_note_assets_hash ON note_assets(file_hash)",
  "CREATE TABLE IF NOT EXISTS known_terms (normalized_term TEXT PRIMARY KEY, language TEXT NOT NULL, status TEXT NOT NULL, seen_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ai_provider_configs (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, display_name TEXT NOT NULL, base_url TEXT, enabled INTEGER NOT NULL DEFAULT 1, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ai_task_routes (task_type TEXT PRIMARY KEY, provider_config_id TEXT, model_id TEXT, fallback_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, FOREIGN KEY(provider_config_id) REFERENCES ai_provider_configs(id) ON DELETE SET NULL)",
  "CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, provider_config_id TEXT, model_id TEXT NOT NULL, task_type TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL, latency_ms INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(provider_config_id) REFERENCES ai_provider_configs(id) ON DELETE SET NULL)",
  "CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at)",
  "CREATE TABLE IF NOT EXISTS ai_cache (cache_key TEXT PRIMARY KEY, task_type TEXT NOT NULL, model_id TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_ai_cache_task ON ai_cache(task_type)",
];

export interface SchemaMigration {
  version: number;
  statements: string[];
}

export const schemaMigrations: SchemaMigration[] = [
  {
    version: 3,
    statements: [
      "ALTER TABLE notes ADD COLUMN anchor_json TEXT",
    ],
  },
  {
    version: 4,
    statements: [
      "ALTER TABLE books ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE books ADD COLUMN reading_status TEXT NOT NULL DEFAULT 'reading'",
    ],
  },
  {
    version: 5,
    statements: [
      "ALTER TABLE books ADD COLUMN privacy_mode TEXT",
    ],
  },
  {
    version: 6,
    statements: [
      "ALTER TABLE books ADD COLUMN provider_policy_json TEXT",
    ],
  },
  {
    version: 7,
    statements: [
      "ALTER TABLE books ADD COLUMN managed_copy INTEGER NOT NULL DEFAULT 0",
    ],
  },
  {
    version: 8,
    statements: [
      "CREATE TABLE IF NOT EXISTS note_assets (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL, file_path TEXT NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE)",
      "CREATE INDEX IF NOT EXISTS idx_note_assets_note ON note_assets(note_id)",
      "CREATE INDEX IF NOT EXISTS idx_note_assets_hash ON note_assets(file_hash)",
    ],
  },
  {
    version: 9,
    statements: [
      "CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, locator_json TEXT NOT NULL, progress REAL, label TEXT, created_at TEXT NOT NULL, FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE)",
      "CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id)",
    ],
  },
];

export const SCHEMA_VERSION = 11;

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
  "CREATE TABLE IF NOT EXISTS resource_providers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, capabilities_json TEXT NOT NULL DEFAULT '{}', config_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS resource_accounts (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, external_account_id TEXT, display_name TEXT, status TEXT NOT NULL DEFAULT 'disconnected', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_resource_accounts_provider ON resource_accounts(provider_id)",
  "CREATE TABLE IF NOT EXISTS resource_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors_json TEXT NOT NULL DEFAULT '[]', description TEXT, identifiers_json TEXT NOT NULL DEFAULT '{}', availability_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}', rights_status TEXT NOT NULL DEFAULT 'unknown', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS resource_sources (id TEXT PRIMARY KEY, resource_item_id TEXT NOT NULL, provider_id TEXT NOT NULL, source_key TEXT NOT NULL, source_type TEXT NOT NULL, uri TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', availability_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE CASCADE, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT, UNIQUE(provider_id, source_key))",
  "CREATE INDEX IF NOT EXISTS idx_resource_sources_item ON resource_sources(resource_item_id)",
  "CREATE INDEX IF NOT EXISTS idx_resource_sources_provider ON resource_sources(provider_id)",
  "CREATE TABLE IF NOT EXISTS resource_files (id TEXT PRIMARY KEY, resource_item_id TEXT NOT NULL, source_id TEXT, name TEXT NOT NULL, relative_path TEXT, size_bytes INTEGER, mime_type TEXT, extension TEXT, identifiers_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE CASCADE, FOREIGN KEY(source_id) REFERENCES resource_sources(id) ON DELETE SET NULL)",
  "CREATE INDEX IF NOT EXISTS idx_resource_files_item ON resource_files(resource_item_id)",
  "CREATE INDEX IF NOT EXISTS idx_resource_files_source ON resource_files(source_id)",
  "CREATE TABLE IF NOT EXISTS transfer_jobs (id TEXT PRIMARY KEY, resource_item_id TEXT, source_id TEXT, file_id TEXT, provider_id TEXT NOT NULL, transport_type TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, bytes_total INTEGER, bytes_completed INTEGER NOT NULL DEFAULT 0, download_rate REAL, upload_rate REAL, error TEXT, temporary_path TEXT, destination_path TEXT, resume_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE SET NULL, FOREIGN KEY(source_id) REFERENCES resource_sources(id) ON DELETE SET NULL, FOREIGN KEY(file_id) REFERENCES resource_files(id) ON DELETE SET NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT)",
  "CREATE INDEX IF NOT EXISTS idx_transfer_jobs_state ON transfer_jobs(state)",
  "CREATE INDEX IF NOT EXISTS idx_transfer_jobs_provider ON transfer_jobs(provider_id)",
  "CREATE TABLE IF NOT EXISTS transfer_files (id TEXT PRIMARY KEY, transfer_job_id TEXT NOT NULL, resource_file_id TEXT, selected INTEGER NOT NULL DEFAULT 1, bytes_total INTEGER, bytes_completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(transfer_job_id) REFERENCES transfer_jobs(id) ON DELETE CASCADE, FOREIGN KEY(resource_file_id) REFERENCES resource_files(id) ON DELETE SET NULL)",
  "CREATE INDEX IF NOT EXISTS idx_transfer_files_job ON transfer_files(transfer_job_id)",
  "CREATE TABLE IF NOT EXISTS resource_history (id TEXT PRIMARY KEY, resource_item_id TEXT, provider_id TEXT, action TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE SET NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE SET NULL)",
  "CREATE INDEX IF NOT EXISTS idx_resource_history_created ON resource_history(created_at)",
  "CREATE TABLE IF NOT EXISTS resource_catalogs (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL DEFAULT 'opds', name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT)",
  "CREATE INDEX IF NOT EXISTS idx_resource_catalogs_provider ON resource_catalogs(provider_id)",
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
  {
    version: 10,
    statements: [
    "CREATE TABLE IF NOT EXISTS resource_providers (id TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, capabilities_json TEXT NOT NULL DEFAULT '{}', config_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS resource_accounts (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, external_account_id TEXT, display_name TEXT, status TEXT NOT NULL DEFAULT 'disconnected', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE CASCADE)",
    "CREATE INDEX IF NOT EXISTS idx_resource_accounts_provider ON resource_accounts(provider_id)",
    "CREATE TABLE IF NOT EXISTS resource_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors_json TEXT NOT NULL DEFAULT '[]', description TEXT, identifiers_json TEXT NOT NULL DEFAULT '{}', availability_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}', rights_status TEXT NOT NULL DEFAULT 'unknown', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS resource_sources (id TEXT PRIMARY KEY, resource_item_id TEXT NOT NULL, provider_id TEXT NOT NULL, source_key TEXT NOT NULL, source_type TEXT NOT NULL, uri TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', availability_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE CASCADE, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT, UNIQUE(provider_id, source_key))",
    "CREATE INDEX IF NOT EXISTS idx_resource_sources_item ON resource_sources(resource_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_resource_sources_provider ON resource_sources(provider_id)",
    "CREATE TABLE IF NOT EXISTS resource_files (id TEXT PRIMARY KEY, resource_item_id TEXT NOT NULL, source_id TEXT, name TEXT NOT NULL, relative_path TEXT, size_bytes INTEGER, mime_type TEXT, extension TEXT, identifiers_json TEXT NOT NULL DEFAULT '{}', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE CASCADE, FOREIGN KEY(source_id) REFERENCES resource_sources(id) ON DELETE SET NULL)",
    "CREATE INDEX IF NOT EXISTS idx_resource_files_item ON resource_files(resource_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_resource_files_source ON resource_files(source_id)",
    "CREATE TABLE IF NOT EXISTS transfer_jobs (id TEXT PRIMARY KEY, resource_item_id TEXT, source_id TEXT, file_id TEXT, provider_id TEXT NOT NULL, transport_type TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, bytes_total INTEGER, bytes_completed INTEGER NOT NULL DEFAULT 0, download_rate REAL, upload_rate REAL, error TEXT, temporary_path TEXT, destination_path TEXT, resume_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE SET NULL, FOREIGN KEY(source_id) REFERENCES resource_sources(id) ON DELETE SET NULL, FOREIGN KEY(file_id) REFERENCES resource_files(id) ON DELETE SET NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT)",
    "CREATE INDEX IF NOT EXISTS idx_transfer_jobs_state ON transfer_jobs(state)",
    "CREATE INDEX IF NOT EXISTS idx_transfer_jobs_provider ON transfer_jobs(provider_id)",
    "CREATE TABLE IF NOT EXISTS transfer_files (id TEXT PRIMARY KEY, transfer_job_id TEXT NOT NULL, resource_file_id TEXT, selected INTEGER NOT NULL DEFAULT 1, bytes_total INTEGER, bytes_completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(transfer_job_id) REFERENCES transfer_jobs(id) ON DELETE CASCADE, FOREIGN KEY(resource_file_id) REFERENCES resource_files(id) ON DELETE SET NULL)",
    "CREATE INDEX IF NOT EXISTS idx_transfer_files_job ON transfer_files(transfer_job_id)",
    "CREATE TABLE IF NOT EXISTS resource_history (id TEXT PRIMARY KEY, resource_item_id TEXT, provider_id TEXT, action TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, FOREIGN KEY(resource_item_id) REFERENCES resource_items(id) ON DELETE SET NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE SET NULL)",
    "CREATE INDEX IF NOT EXISTS idx_resource_history_created ON resource_history(created_at)",
    ],
  },
  {
    version: 11,
    statements: [
      "CREATE TABLE IF NOT EXISTS resource_catalogs (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL DEFAULT 'opds', name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(provider_id) REFERENCES resource_providers(id) ON DELETE RESTRICT)",
      "CREATE INDEX IF NOT EXISTS idx_resource_catalogs_provider ON resource_catalogs(provider_id)",
    ],
  },
];

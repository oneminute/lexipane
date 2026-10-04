mod library_files;
mod note_assets;
mod ocr;
mod resources;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(resources::http::HttpTransferManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            library_files::book_file_sha256,
            library_files::check_book_files,
            library_files::copy_book_to_managed_library,
            library_files::delete_managed_book_copy,
            library_files::cleanup_managed_library,
            note_assets::save_note_asset,
            note_assets::delete_note_asset,
            note_assets::cleanup_note_assets,
            ocr::local_ocr_status,
            ocr::ocr_image,
            resources::resource_runtime_capabilities,
            resources::http::resource_http_probe,
            resources::http::resource_http_fetch_text,
            resources::http::resource_http_start_download,
            resources::http::resource_http_pause,
            resources::http::resource_http_cancel,
            resources::http::resource_http_cleanup_temp,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_has,
            secrets::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running LexiPane");
}

mod library_files;
mod note_assets;
mod ocr;
mod resources;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(resources::cloud::CloudTransferManager::default())
        .manage(resources::ed2k::Ed2kManager::default())
        .manage(resources::http::HttpTransferManager::default())
        .manage(resources::torrent::TorrentManager::default())
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
            resources::cloud::resource_cloud_list,
            resources::cloud::resource_cloud_search,
            resources::cloud::resource_cloud_start_download,
            resources::cloud::resource_cloud_pause,
            resources::cloud::resource_cloud_cancel,
            resources::cloud::resource_cloud_cleanup,
            resources::ed2k::resource_ed2k_status,
            resources::ed2k::resource_ed2k_search,
            resources::ed2k::resource_ed2k_add_link,
            resources::ed2k::resource_ed2k_download_result,
            resources::ed2k::resource_ed2k_attach,
            resources::ed2k::resource_ed2k_pause,
            resources::ed2k::resource_ed2k_resume,
            resources::ed2k::resource_ed2k_cancel,
            resources::http::resource_http_probe,
            resources::http::resource_http_fetch_text,
            resources::http::resource_http_start_download,
            resources::http::resource_http_pause,
            resources::http::resource_http_cancel,
            resources::http::resource_http_cleanup_temp,
            resources::torrent::resource_torrent_preview,
            resources::torrent::resource_torrent_start_download,
            resources::torrent::resource_torrent_pause,
            resources::torrent::resource_torrent_cancel,
            resources::torrent::resource_torrent_cleanup,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_has,
            secrets::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running LexiPane");
}

use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use librqbit::{
    api::{Api, TorrentIdOrHash},
    AddTorrent, AddTorrentOptions, Session,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{fs, sync::Mutex, time::sleep};

const EVENT_NAME: &str = "resource-transfer-event";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPreviewFile {
    pub index: usize,
    pub name: String,
    pub length: u64,
    pub included: bool,
    pub book_candidate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentPreviewResult {
    pub info_hash: String,
    pub name: Option<String>,
    pub files: Vec<TorrentPreviewFile>,
    pub seen_peers: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStartResult {
    pub job_id: String,
    pub torrent_id: usize,
    pub started: bool,
}

#[derive(Debug, Clone)]
struct TorrentRuntimeJob {
    torrent_id: usize,
    input: String,
    file_path: PathBuf,
    file_name: String,
}

#[derive(Default)]
struct TorrentState {
    api: Option<Api>,
    jobs: HashMap<String, TorrentRuntimeJob>,
}

#[derive(Clone, Default)]
pub struct TorrentManager {
    state: Arc<Mutex<TorrentState>>,
}

fn is_book_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".pdf")
        || lower.ends_with(".epub")
        || lower.ends_with(".mobi")
        || lower.ends_with(".azw")
        || lower.ends_with(".azw3")
}

fn validate_input(input: &str) -> Result<String, String> {
    let trimmed = input.trim();

    if trimmed.starts_with("magnet:?") {
        return Ok(trimmed.to_string());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    Err(
        "BitTorrent currently accepts magnet links or HTTP/HTTPS torrent metadata URLs."
            .to_string(),
    )
}

fn safe_job_component(job_id: &str) -> String {
    job_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn emit_event(app: &AppHandle, event: ResourceTransferEvent) {
    let _ = app.emit(EVENT_NAME, event);
}

fn transfer_event(
    job_id: &str,
    state: &str,
    bytes_total: Option<u64>,
    bytes_completed: u64,
) -> ResourceTransferEvent {
    let progress = bytes_total
        .filter(|total| *total > 0)
        .map(|total| (bytes_completed as f64 / total as f64).clamp(0.0, 1.0))
        .unwrap_or(0.0);

    ResourceTransferEvent {
        job_id: job_id.to_string(),
        state: state.to_string(),
        bytes_total,
        bytes_completed,
        progress,
        download_rate: None,
        temp_path: None,
        file_name: None,
        content_type: None,
        final_url: None,
        detected_format: None,
        error: None,
    }
}

impl TorrentManager {
    async fn api(&self, app: &AppHandle) -> Result<Api, String> {
        let mut state = self.state.lock().await;

        if let Some(api) = state.api.as_ref() {
            return Ok(api.clone());
        }

        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
        let root = app_data.join("resource-torrents");

        fs::create_dir_all(&root)
            .await
            .map_err(|error| format!("Unable to create torrent directory: {error}"))?;

        let session = Session::new(root)
            .await
            .map_err(|error| format!("Unable to start BitTorrent session: {error}"))?;
        let api = Api::new(session, None);

        state.api = Some(api.clone());
        Ok(api)
    }

    async fn insert_job(
        &self,
        job_id: String,
        job: TorrentRuntimeJob,
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;

        if state.jobs.contains_key(&job_id) {
            return Err("This BitTorrent job is already active.".to_string());
        }

        if state
            .jobs
            .values()
            .any(|current| current.torrent_id == job.torrent_id)
        {
            return Err(
                "This torrent is already active in another LexiPane transfer."
                    .to_string(),
            );
        }

        state.jobs.insert(job_id, job);
        Ok(())
    }

    async fn get_job(&self, job_id: &str) -> Option<TorrentRuntimeJob> {
        self.state.lock().await.jobs.get(job_id).cloned()
    }

    async fn remove_job(&self, job_id: &str) {
        self.state.lock().await.jobs.remove(job_id);
    }
}

async fn preview(
    app: &AppHandle,
    manager: &TorrentManager,
    input: &str,
) -> Result<TorrentPreviewResult, String> {
    let input = validate_input(input)?;
    let api = manager.api(app).await?;

    let options = AddTorrentOptions {
        list_only: true,
        ..Default::default()
    };

    let response = api
        .api_add_torrent(AddTorrent::from_url(&input), Some(options))
        .await
        .map_err(|error| format!("Unable to resolve torrent metadata: {error}"))?;

    let files = response
        .details
        .files
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, file)| TorrentPreviewFile {
            index,
            name: file.name.clone(),
            length: file.length,
            included: file.included,
            book_candidate: is_book_candidate(&file.name),
        })
        .collect();

    Ok(TorrentPreviewResult {
        info_hash: response.details.info_hash,
        name: response.details.name,
        files,
        seen_peers: response.seen_peers.map(|items| items.len()).unwrap_or(0),
    })
}

#[tauri::command]
pub async fn resource_torrent_preview(
    app: AppHandle,
    manager: State<'_, TorrentManager>,
    input: String,
) -> Result<TorrentPreviewResult, String> {
    preview(&app, manager.inner(), &input).await
}

async fn monitor_job(
    app: AppHandle,
    manager: TorrentManager,
    api: Api,
    job_id: String,
) {
    loop {
        let Some(job) = manager.get_job(&job_id).await else {
            return;
        };

        let idx = TorrentIdOrHash::Id(job.torrent_id);

        let handle = match api.mgr_handle(idx) {
            Ok(handle) => handle,
            Err(error) => {
                let mut event = transfer_event(&job_id, "failed", None, 0);
                event.error = Some(format!("Torrent handle disappeared: {error}"));
                emit_event(&app, event);
                manager.remove_job(&job_id).await;
                return;
            }
        };

        if handle.is_paused() {
            let stats = handle.stats();
            let mut event = transfer_event(
                &job_id,
                "paused",
                Some(stats.total_bytes),
                stats.progress_bytes,
            );
            event.file_name = Some(job.file_name.clone());
            event.final_url = Some(job.input.clone());
            emit_event(&app, event);
            sleep(Duration::from_millis(700)).await;
            continue;
        }

        let stats = handle.stats();

        if let Some(error) = stats.error.as_ref() {
            let mut event = transfer_event(
                &job_id,
                "failed",
                Some(stats.total_bytes),
                stats.progress_bytes,
            );
            event.error = Some(error.clone());
            event.file_name = Some(job.file_name.clone());
            event.final_url = Some(job.input.clone());
            emit_event(&app, event);
            manager.remove_job(&job_id).await;
            return;
        }

        if stats.finished {
            let validation_path = job.file_path.clone();
            let detected = tauri::async_runtime::spawn_blocking(move || {
                validate_downloaded_book(&validation_path)
            })
            .await;

            let detected_format = match detected {
                Ok(Ok(format)) => format,
                Ok(Err(error)) => {
                    let mut event = transfer_event(
                        &job_id,
                        "failed",
                        Some(stats.total_bytes),
                        stats.progress_bytes,
                    );
                    event.error = Some(error);
                    event.file_name = Some(job.file_name.clone());
                    event.final_url = Some(job.input.clone());
                    emit_event(&app, event);
                    let _ = api.api_torrent_action_delete(idx).await;
                    manager.remove_job(&job_id).await;
                    return;
                }
                Err(error) => {
                    let mut event = transfer_event(
                        &job_id,
                        "failed",
                        Some(stats.total_bytes),
                        stats.progress_bytes,
                    );
                    event.error = Some(format!(
                        "Unable to validate completed torrent file: {error}"
                    ));
                    emit_event(&app, event);
                    let _ = api.api_torrent_action_delete(idx).await;
                    manager.remove_job(&job_id).await;
                    return;
                }
            };

            let mut event = transfer_event(
                &job_id,
                "downloaded",
                Some(stats.total_bytes),
                stats.progress_bytes,
            );
            event.progress = 1.0;
            event.temp_path = Some(job.file_path.to_string_lossy().to_string());
            event.file_name = Some(job.file_name.clone());
            event.final_url = Some(job.input.clone());
            event.detected_format = Some(detected_format);
            emit_event(&app, event);

            let _ = api.api_torrent_action_forget(idx).await;
            manager.remove_job(&job_id).await;
            return;
        }

        let mut event = transfer_event(
            &job_id,
            "running",
            Some(stats.total_bytes),
            stats.progress_bytes,
        );
        event.file_name = Some(job.file_name.clone());
        event.final_url = Some(job.input.clone());
        emit_event(&app, event);

        sleep(Duration::from_millis(500)).await;
    }
}

#[tauri::command]
pub async fn resource_torrent_start_download(
    app: AppHandle,
    manager: State<'_, TorrentManager>,
    job_id: String,
    input: String,
    file_index: usize,
) -> Result<TorrentStartResult, String> {
    let input = validate_input(&input)?;
    let manager = manager.inner().clone();
    let api = manager.api(&app).await?;

    if let Some(existing) = manager.get_job(&job_id).await {
        api.api_torrent_action_start(TorrentIdOrHash::Id(existing.torrent_id))
            .await
            .map_err(|error| format!("Unable to resume torrent: {error}"))?;

        return Ok(TorrentStartResult {
            job_id,
            torrent_id: existing.torrent_id,
            started: true,
        });
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let output_folder = app_data
        .join("resource-torrents")
        .join(safe_job_component(&job_id));

    fs::create_dir_all(&output_folder)
        .await
        .map_err(|error| format!("Unable to create torrent job folder: {error}"))?;

    let options = AddTorrentOptions {
        only_files: Some(vec![file_index]),
        output_folder: Some(output_folder.to_string_lossy().to_string()),
        overwrite: true,
        ..Default::default()
    };

    let response = api
        .api_add_torrent(AddTorrent::from_url(&input), Some(options))
        .await
        .map_err(|error| format!("Unable to start torrent: {error}"))?;

    let torrent_id = response
        .id
        .ok_or_else(|| "Torrent engine did not return a managed torrent id.".to_string())?;

    let files = response.details.files.unwrap_or_default();
    let selected = files
        .get(file_index)
        .ok_or_else(|| "Selected torrent file index is not available.".to_string())?;

    if !is_book_candidate(&selected.name) {
        let _ = api
            .api_torrent_action_delete(TorrentIdOrHash::Id(torrent_id))
            .await;
        return Err(
            "LexiPane imports Reader-supported PDF, EPUB, MOBI, AZW, and AZW3 files from torrents."
                .to_string(),
        );
    }

    let file_path = Path::new(&response.output_folder).join(&selected.name);

    manager
        .insert_job(
            job_id.clone(),
            TorrentRuntimeJob {
                torrent_id,
                input: input.clone(),
                file_path,
                file_name: selected.name.clone(),
            },
        )
        .await?;

    let spawned_app = app.clone();
    let spawned_manager = manager.clone();
    let spawned_api = api.clone();
    let spawned_job_id = job_id.clone();

    tauri::async_runtime::spawn(async move {
        monitor_job(
            spawned_app,
            spawned_manager,
            spawned_api,
            spawned_job_id,
        )
        .await;
    });

    Ok(TorrentStartResult {
        job_id,
        torrent_id,
        started: true,
    })
}

#[tauri::command]
pub async fn resource_torrent_pause(
    app: AppHandle,
    manager: State<'_, TorrentManager>,
    job_id: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let Some(job) = manager.get_job(&job_id).await else {
        return Ok(false);
    };
    let api = manager.api(&app).await?;

    api.api_torrent_action_pause(TorrentIdOrHash::Id(job.torrent_id))
        .await
        .map_err(|error| format!("Unable to pause torrent: {error}"))?;

    Ok(true)
}

#[tauri::command]
pub async fn resource_torrent_cancel(
    app: AppHandle,
    manager: State<'_, TorrentManager>,
    job_id: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let Some(job) = manager.get_job(&job_id).await else {
        return Ok(false);
    };
    let api = manager.api(&app).await?;

    api.api_torrent_action_delete(TorrentIdOrHash::Id(job.torrent_id))
        .await
        .map_err(|error| format!("Unable to cancel torrent: {error}"))?;

    manager.remove_job(&job_id).await;

    let mut event = transfer_event(&job_id, "canceled", None, 0);
    event.file_name = Some(job.file_name);
    event.final_url = Some(job.input);
    emit_event(&app, event);

    Ok(true)
}

#[tauri::command]
pub async fn resource_torrent_cleanup(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let target = app_data
        .join("resource-torrents")
        .join(safe_job_component(&job_id));

    if !target.exists() {
        return Ok(false);
    }

    fs::remove_dir_all(&target)
        .await
        .map_err(|error| format!("Unable to clean torrent files: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_magnets_and_torrent_urls_only() {
        assert!(validate_input("magnet:?xt=urn:btih:abc").is_ok());
        assert!(validate_input("https://example.test/book.torrent").is_ok());
        assert!(validate_input("ed2k://example").is_err());
    }

    #[test]
    fn recognizes_reader_book_files() {
        assert!(is_book_candidate("folder/book.epub"));
        assert!(is_book_candidate("BOOK.PDF"));
        assert!(is_book_candidate("reader/book.mobi"));
        assert!(is_book_candidate("reader/book.azw"));
        assert!(is_book_candidate("reader/book.azw3"));
        assert!(!is_book_candidate("movie.mkv"));
    }
}

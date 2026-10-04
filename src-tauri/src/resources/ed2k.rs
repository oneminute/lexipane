use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tokio::{process::Command, sync::Mutex, time::sleep};

const EVENT_NAME: &str = "resource-transfer-event";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kConnectionConfig {
    pub executable: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub password: Option<String>,
    pub incoming_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kStatusResult {
    pub available: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kLinkMetadata {
    pub name: String,
    pub size: u64,
    pub hash: String,
    pub book_candidate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kSearchResult {
    pub index: usize,
    pub name: String,
    pub size: Option<u64>,
    pub sources: Option<u32>,
    pub book_candidate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kSearchResponse {
    pub query: String,
    pub search_type: String,
    pub results: Vec<Ed2kSearchResult>,
    pub raw_output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kStartResult {
    pub job_id: String,
    pub name: String,
    pub size: Option<u64>,
    pub hash: Option<String>,
    pub started: bool,
}

#[derive(Debug, Clone)]
struct Ed2kRuntimeJob {
    config: Ed2kConnectionConfig,
    name: String,
    size: Option<u64>,
    hash: Option<String>,
    incoming_path: Option<PathBuf>,
    paused: bool,
}

#[derive(Clone, Default)]
pub struct Ed2kManager {
    jobs: Arc<Mutex<HashMap<String, Ed2kRuntimeJob>>>,
}

impl Ed2kManager {
    async fn insert(
        &self,
        job_id: String,
        job: Ed2kRuntimeJob,
    ) -> Result<(), String> {
        let mut jobs = self.jobs.lock().await;
        if jobs.contains_key(&job_id) {
            return Err("This ED2K job is already active.".to_string());
        }
        jobs.insert(job_id, job);
        Ok(())
    }

    async fn get(&self, job_id: &str) -> Option<Ed2kRuntimeJob> {
        self.jobs.lock().await.get(job_id).cloned()
    }

    async fn set_paused(&self, job_id: &str, paused: bool) -> bool {
        let mut jobs = self.jobs.lock().await;
        let Some(job) = jobs.get_mut(job_id) else {
            return false;
        };
        job.paused = paused;
        true
    }

    async fn remove(&self, job_id: &str) {
        self.jobs.lock().await.remove(job_id);
    }
}

fn executable(config: &Ed2kConnectionConfig) -> String {
    config
        .executable
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("amulecmd")
        .to_string()
}

fn validate_config(config: &Ed2kConnectionConfig) -> Result<(), String> {
    if let Some(host) = config.host.as_deref() {
        if host.contains('\n') || host.contains('\r') {
            return Err("Invalid aMule host.".to_string());
        }
    }

    if let Some(path) = config.executable.as_deref() {
        if path.contains('\n') || path.contains('\r') {
            return Err("Invalid amulecmd executable path.".to_string());
        }
    }

    Ok(())
}

fn clean_query(query: &str) -> Result<String, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("ED2K search query is empty.".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("ED2K search query contains invalid characters.".to_string());
    }
    Ok(trimmed.to_string())
}

async fn run_amulecmd(
    config: &Ed2kConnectionConfig,
    command: &str,
) -> Result<String, String> {
    validate_config(config)?;

    let mut process = Command::new(executable(config));
    process
        .arg("-h")
        .arg(
            config
                .host
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("127.0.0.1"),
        )
        .arg("-p")
        .arg(config.port.unwrap_or(4712).to_string());

    if let Some(password) = config
        .password
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        process.arg("-P").arg(password);
    }

    process
        .arg("-c")
        .arg(command)
        .env("LC_ALL", "C")
        .env("LANG", "C");

    let output = process.output().await.map_err(|error| {
        format!(
            "Unable to run {}: {error}",
            executable(config)
        )
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if !output.status.success() {
        return Err(if combined.is_empty() {
            format!("amulecmd exited with status {}.", output.status)
        } else {
            combined
        });
    }

    Ok(combined)
}

fn is_book_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".pdf") || lower.ends_with(".epub")
}

pub fn parse_ed2k_file_link(link: &str) -> Result<Ed2kLinkMetadata, String> {
    let trimmed = link.trim();

    if !trimmed.to_ascii_lowercase().starts_with("ed2k://|file|") {
        return Err("Only ED2K file links are supported.".to_string());
    }

    let fields: Vec<&str> = trimmed.split('|').collect();
    if fields.len() < 6 || !fields[1].eq_ignore_ascii_case("file") {
        return Err("Malformed ED2K file link.".to_string());
    }

    let raw_name = fields[2];
    let name = urlencoding::decode(raw_name)
        .map_err(|_| "ED2K filename is not valid URL encoding.".to_string())?
        .into_owned();
    let size = fields[3]
        .parse::<u64>()
        .map_err(|_| "ED2K file size is invalid.".to_string())?;
    let hash = fields[4].trim().to_ascii_lowercase();

    if hash.len() != 32 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("ED2K file hash is invalid.".to_string());
    }

    Ok(Ed2kLinkMetadata {
        book_candidate: is_book_candidate(&name),
        name,
        size,
        hash,
    })
}

fn parse_result_line(line: &str) -> Option<Ed2kSearchResult> {
    let trimmed = line.trim();
    let dot = trimmed.find('.')?;
    let index = trimmed[..dot].trim().parse::<usize>().ok()?;
    let rest = trimmed[dot + 1..].trim();
    let parts: Vec<&str> = rest.split_whitespace().collect();

    if parts.len() < 3 {
        return None;
    }

    let sources = parts.last()?.parse::<u32>().ok();
    let size_mb = parts
        .get(parts.len().saturating_sub(2))
        .and_then(|value| value.parse::<f64>().ok());
    let filename_end = if size_mb.is_some() {
        parts.len().saturating_sub(2)
    } else if sources.is_some() {
        parts.len().saturating_sub(1)
    } else {
        parts.len()
    };

    if filename_end == 0 {
        return None;
    }

    let name = parts[..filename_end].join(" ");
    if name.is_empty() {
        return None;
    }

    Some(Ed2kSearchResult {
        index,
        book_candidate: is_book_candidate(&name),
        name,
        size: size_mb.map(|value| {
            (value * 1024.0 * 1024.0).round().max(0.0) as u64
        }),
        sources,
    })
}

fn parse_search_results(output: &str) -> Vec<Ed2kSearchResult> {
    output.lines().filter_map(parse_result_line).collect()
}

fn find_progress(output: &str, name: &str) -> Option<f64> {
    let needle = name.to_ascii_lowercase();

    for line in output.lines() {
        if !line.to_ascii_lowercase().contains(&needle) {
            continue;
        }

        for token in line.split_whitespace() {
            let cleaned = token
                .trim_matches(|ch: char| {
                    matches!(ch, '[' | ']' | '(' | ')' | ',')
                });

            if let Some(percent) = cleaned.strip_suffix('%') {
                if let Ok(value) = percent.parse::<f64>() {
                    return Some((value / 100.0).clamp(0.0, 1.0));
                }
            }
        }
    }

    None
}

fn parse_download_number(output: &str, name: &str) -> Option<String> {
    let needle = name.to_ascii_lowercase();

    for line in output.lines() {
        if !line.to_ascii_lowercase().contains(&needle) {
            continue;
        }

        let first = line.split_whitespace().next()?;
        let cleaned = first.trim_end_matches('.');
        if cleaned.chars().all(|ch| ch.is_ascii_digit()) {
            return Some(cleaned.to_string());
        }
    }

    None
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

async fn command_selector(job: &Ed2kRuntimeJob) -> Result<String, String> {
    if let Some(hash) = job.hash.as_deref() {
        return Ok(hash.to_string());
    }

    let queue = run_amulecmd(&job.config, "Show DL").await?;
    parse_download_number(&queue, &job.name).ok_or_else(|| {
        "Unable to find this ED2K job in the aMule download queue.".to_string()
    })
}

async fn monitor_job(
    app: AppHandle,
    manager: Ed2kManager,
    job_id: String,
) {
    loop {
        let Some(job) = manager.get(&job_id).await else {
            return;
        };

        if job.paused {
            let mut event = transfer_event(&job_id, "paused", job.size, 0);
            event.file_name = Some(job.name.clone());
            emit_event(&app, event);
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        if let Some(path) = job.incoming_path.as_ref() {
            if let Ok(metadata) = fs_metadata(path).await {
                let complete = job
                    .size
                    .map(|expected| metadata.len() >= expected)
                    .unwrap_or(metadata.len() > 0);

                if complete {
                    let validation_path = path.clone();
                    let detected = tauri::async_runtime::spawn_blocking(
                        move || validate_downloaded_book(&validation_path),
                    )
                    .await;

                    let detected_format = match detected {
                        Ok(Ok(format)) => format,
                        Ok(Err(error)) => {
                            let mut event = transfer_event(
                                &job_id,
                                "failed",
                                job.size,
                                metadata.len(),
                            );
                            event.error = Some(error);
                            event.file_name = Some(job.name.clone());
                            emit_event(&app, event);
                            manager.remove(&job_id).await;
                            return;
                        }
                        Err(error) => {
                            let mut event = transfer_event(
                                &job_id,
                                "failed",
                                job.size,
                                metadata.len(),
                            );
                            event.error = Some(format!(
                                "Unable to validate ED2K result: {error}"
                            ));
                            emit_event(&app, event);
                            manager.remove(&job_id).await;
                            return;
                        }
                    };

                    let mut event = transfer_event(
                        &job_id,
                        "downloaded",
                        job.size.or(Some(metadata.len())),
                        metadata.len(),
                    );
                    event.progress = 1.0;
                    event.temp_path =
                        Some(path.to_string_lossy().to_string());
                    event.file_name = Some(job.name.clone());
                    event.detected_format = Some(detected_format);
                    emit_event(&app, event);
                    manager.remove(&job_id).await;
                    return;
                }
            }
        }

        let queue = run_amulecmd(&job.config, "Show DL").await;
        match queue {
            Ok(output) => {
                let progress = find_progress(&output, &job.name).unwrap_or(0.0);
                let completed = job
                    .size
                    .map(|total| (total as f64 * progress) as u64)
                    .unwrap_or(0);
                let mut event =
                    transfer_event(&job_id, "running", job.size, completed);
                event.progress = progress;
                event.file_name = Some(job.name.clone());
                emit_event(&app, event);
            }
            Err(error) => {
                let mut event =
                    transfer_event(&job_id, "failed", job.size, 0);
                event.error = Some(error);
                event.file_name = Some(job.name.clone());
                emit_event(&app, event);
                manager.remove(&job_id).await;
                return;
            }
        }

        sleep(Duration::from_secs(2)).await;
    }
}

async fn fs_metadata(path: &Path) -> Result<std::fs::Metadata, std::io::Error> {
    tokio::fs::metadata(path).await
}

fn incoming_path(
    config: &Ed2kConnectionConfig,
    name: &str,
) -> Option<PathBuf> {
    config
        .incoming_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .map(|dir| dir.join(name))
}

#[tauri::command]
pub async fn resource_ed2k_status(
    config: Ed2kConnectionConfig,
) -> Result<Ed2kStatusResult, String> {
    match run_amulecmd(&config, "Status").await {
        Ok(output) => Ok(Ed2kStatusResult {
            available: true,
            output,
        }),
        Err(error) => Ok(Ed2kStatusResult {
            available: false,
            output: error,
        }),
    }
}

#[tauri::command]
pub async fn resource_ed2k_search(
    config: Ed2kConnectionConfig,
    query: String,
    search_type: Option<String>,
) -> Result<Ed2kSearchResponse, String> {
    let query = clean_query(&query)?;
    let search_type = match search_type
        .unwrap_or_else(|| "global".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "global" => "global",
        "kad" => "kad",
        "local" => "local",
        _ => return Err("Unsupported ED2K search type.".to_string()),
    };

    let command = format!("Search {search_type} {query}");
    let _ = run_amulecmd(&config, &command).await;
    sleep(Duration::from_millis(2500)).await;
    let output = run_amulecmd(&config, "Results").await?;
    let results = parse_search_results(&output);

    Ok(Ed2kSearchResponse {
        query,
        search_type: search_type.to_string(),
        results,
        raw_output: output,
    })
}

#[tauri::command]
pub async fn resource_ed2k_add_link(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
    config: Ed2kConnectionConfig,
    link: String,
) -> Result<Ed2kStartResult, String> {
    let metadata = parse_ed2k_file_link(&link)?;
    if !metadata.book_candidate {
        return Err(
            "LexiPane currently imports PDF/EPUB files from ED2K."
                .to_string(),
        );
    }

    run_amulecmd(&config, &format!("Add {}", link.trim())).await?;

    let manager = manager.inner().clone();
    manager
        .insert(
            job_id.clone(),
            Ed2kRuntimeJob {
                config: config.clone(),
                name: metadata.name.clone(),
                size: Some(metadata.size),
                hash: Some(metadata.hash.clone()),
                incoming_path: incoming_path(&config, &metadata.name),
                paused: false,
            },
        )
        .await?;

    let spawned_manager = manager.clone();
    let spawned_app = app.clone();
    let spawned_job = job_id.clone();
    tauri::async_runtime::spawn(async move {
        monitor_job(spawned_app, spawned_manager, spawned_job).await;
    });

    Ok(Ed2kStartResult {
        job_id,
        name: metadata.name,
        size: Some(metadata.size),
        hash: Some(metadata.hash),
        started: true,
    })
}

#[tauri::command]
pub async fn resource_ed2k_download_result(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
    config: Ed2kConnectionConfig,
    result_index: usize,
    name: String,
    size: Option<u64>,
) -> Result<Ed2kStartResult, String> {
    if !is_book_candidate(&name) {
        return Err(
            "LexiPane currently imports PDF/EPUB files from ED2K."
                .to_string(),
        );
    }

    run_amulecmd(&config, &format!("Download {result_index}")).await?;

    let manager = manager.inner().clone();
    manager
        .insert(
            job_id.clone(),
            Ed2kRuntimeJob {
                config: config.clone(),
                name: name.clone(),
                size,
                hash: None,
                incoming_path: incoming_path(&config, &name),
                paused: false,
            },
        )
        .await?;

    let spawned_manager = manager.clone();
    let spawned_app = app.clone();
    let spawned_job = job_id.clone();
    tauri::async_runtime::spawn(async move {
        monitor_job(spawned_app, spawned_manager, spawned_job).await;
    });

    Ok(Ed2kStartResult {
        job_id,
        name,
        size,
        hash: None,
        started: true,
    })
}

#[tauri::command]
pub async fn resource_ed2k_attach(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
    config: Ed2kConnectionConfig,
    name: String,
    size: Option<u64>,
    hash: Option<String>,
    paused: Option<bool>,
) -> Result<bool, String> {
    let manager = manager.inner().clone();

    if manager.get(&job_id).await.is_some() {
        return Ok(true);
    }

    // Verify the sidecar queue still contains the file before attaching.
    let queue = run_amulecmd(&config, "Show DL").await?;
    let lower_queue = queue.to_ascii_lowercase();
    let hash_present = hash
        .as_deref()
        .map(|value| lower_queue.contains(&value.to_ascii_lowercase()))
        .unwrap_or(false);
    let name_present = lower_queue.contains(&name.to_ascii_lowercase());

    if !hash_present && !name_present {
        return Ok(false);
    }

    manager
        .insert(
            job_id.clone(),
            Ed2kRuntimeJob {
                config: config.clone(),
                name: name.clone(),
                size,
                hash,
                incoming_path: incoming_path(&config, &name),
                paused: paused.unwrap_or(false),
            },
        )
        .await?;

    let spawned_manager = manager.clone();
    let spawned_app = app.clone();
    tauri::async_runtime::spawn(async move {
        monitor_job(spawned_app, spawned_manager, job_id).await;
    });

    Ok(true)
}

#[tauri::command]
pub async fn resource_ed2k_pause(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let Some(job) = manager.get(&job_id).await else {
        return Ok(false);
    };
    let selector = command_selector(&job).await?;
    run_amulecmd(&job.config, &format!("Pause {selector}")).await?;
    manager.set_paused(&job_id, true).await;

    let mut event = transfer_event(&job_id, "paused", job.size, 0);
    event.file_name = Some(job.name);
    emit_event(&app, event);
    Ok(true)
}

#[tauri::command]
pub async fn resource_ed2k_resume(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let Some(job) = manager.get(&job_id).await else {
        return Ok(false);
    };
    let selector = command_selector(&job).await?;
    run_amulecmd(&job.config, &format!("Resume {selector}")).await?;
    manager.set_paused(&job_id, false).await;

    let mut event = transfer_event(&job_id, "running", job.size, 0);
    event.file_name = Some(job.name);
    emit_event(&app, event);
    Ok(true)
}

#[tauri::command]
pub async fn resource_ed2k_cancel(
    app: AppHandle,
    manager: State<'_, Ed2kManager>,
    job_id: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let Some(job) = manager.get(&job_id).await else {
        return Ok(false);
    };
    let selector = command_selector(&job).await?;
    run_amulecmd(&job.config, &format!("Cancel {selector}")).await?;
    manager.remove(&job_id).await;

    let mut event = transfer_event(&job_id, "canceled", job.size, 0);
    event.file_name = Some(job.name);
    emit_event(&app, event);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ed2k_file_links() {
        let metadata = parse_ed2k_file_link(
            "ed2k://|file|Example%20Book.epub|1234|0123456789ABCDEF0123456789ABCDEF|/",
        )
        .expect("valid ED2K link");

        assert_eq!(metadata.name, "Example Book.epub");
        assert_eq!(metadata.size, 1234);
        assert_eq!(
            metadata.hash,
            "0123456789abcdef0123456789abcdef"
        );
        assert!(metadata.book_candidate);
    }

    #[test]
    fn parses_classic_amule_search_rows() {
        let line = "0.    Example Book.epub    12.5    8";
        let result = parse_result_line(line).expect("search row");

        assert_eq!(result.index, 0);
        assert_eq!(result.name, "Example Book.epub");
        assert_eq!(result.sources, Some(8));
        assert!(result.book_candidate);
    }
}

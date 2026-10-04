use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use futures_util::StreamExt;
use reqwest::{
    header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, RANGE},
    Client, Method, Response, StatusCode, Url,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
    sync::Mutex,
};

const EVENT_NAME: &str = "resource-transfer-event";
const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSE: u8 = 1;
const CONTROL_CANCEL: u8 = 2;
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEntry {
    pub id: String,
    pub name: String,
    pub size: Option<u64>,
    pub mime_type: Option<String>,
    pub is_folder: bool,
    pub path: Option<String>,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudListResult {
    pub provider: String,
    pub entries: Vec<CloudEntry>,
}

#[derive(Clone, Default)]
pub struct CloudTransferManager {
    controls: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

impl CloudTransferManager {
    async fn register(&self, job_id: &str) -> Result<Arc<AtomicU8>, String> {
        let mut controls = self.controls.lock().await;
        if controls.contains_key(job_id) {
            return Err("This cloud transfer is already running.".to_string());
        }

        let control = Arc::new(AtomicU8::new(CONTROL_RUNNING));
        controls.insert(job_id.to_string(), control.clone());
        Ok(control)
    }

    async fn signal(&self, job_id: &str, signal: u8) -> bool {
        let controls = self.controls.lock().await;
        let Some(control) = controls.get(job_id) else {
            return false;
        };
        control.store(signal, Ordering::Relaxed);
        true
    }

    async fn remove(&self, job_id: &str) {
        self.controls.lock().await.remove(job_id);
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("LexiPane/0.1 ResourceHub")
        .build()
        .map_err(|error| format!("Unable to initialize cloud HTTP client: {error}"))
}

fn bearer(token: &str) -> String {
    format!("Bearer {}", token.trim())
}

fn provider_id(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "google-drive" => Ok("google-drive"),
        "dropbox" => Ok("dropbox"),
        "onedrive" => Ok("onedrive"),
        _ => Err("Unsupported cloud provider.".to_string()),
    }
}

fn safe_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();

    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
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

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(ToString::to_string)
}

fn u64_field(value: &Value, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(|item| {
            item.as_u64().or_else(|| {
                item.as_str()
                    .and_then(|raw| raw.parse::<u64>().ok())
            })
        })
}

async fn google_list(
    client: &Client,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<CloudEntry>, String> {
    let mut url = Url::parse("https://www.googleapis.com/drive/v3/files")
        .map_err(|error| error.to_string())?;
    let q = if let Some(query) = query.filter(|item| !item.trim().is_empty()) {
        format!(
            "name contains '{}' and trashed = false",
            query.replace(''', "\\'")
        )
    } else {
        format!(
            "'{}' in parents and trashed = false",
            folder.filter(|item| !item.is_empty()).unwrap_or("root")
        )
    };

    url.query_pairs_mut()
        .append_pair("pageSize", "100")
        .append_pair(
            "fields",
            "files(id,name,mimeType,size,modifiedTime,parents,webViewLink)",
        )
        .append_pair("spaces", "drive")
        .append_pair("q", &q);

    let response = client
        .get(url)
        .header(AUTHORIZATION, bearer(token))
        .send()
        .await
        .map_err(|error| format!("Google Drive request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Google Drive returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid Google Drive response: {error}"))?;

    Ok(body
        .get("files")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let id = string_field(item, "id")?;
            let name = string_field(item, "name")?;
            let mime_type = string_field(item, "mimeType");
            Some(CloudEntry {
                id,
                name,
                size: u64_field(item, "size"),
                is_folder: mime_type.as_deref()
                    == Some("application/vnd.google-apps.folder"),
                mime_type,
                path: None,
                modified_at: string_field(item, "modifiedTime"),
            })
        })
        .collect())
}

async fn dropbox_post(
    client: &Client,
    token: &str,
    endpoint: &str,
    body: Value,
) -> Result<Value, String> {
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, bearer(token))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Dropbox request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Dropbox returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    response
        .json()
        .await
        .map_err(|error| format!("Invalid Dropbox response: {error}"))
}

fn dropbox_entry(item: &Value) -> Option<CloudEntry> {
    let tag = item.get(".tag")?.as_str()?;
    let id = string_field(item, "id")
        .or_else(|| string_field(item, "path_lower"))?;
    let name = string_field(item, "name")?;

    Some(CloudEntry {
        id,
        name,
        size: u64_field(item, "size"),
        mime_type: None,
        is_folder: tag == "folder",
        path: string_field(item, "path_lower"),
        modified_at: string_field(item, "server_modified"),
    })
}

async fn dropbox_list(
    client: &Client,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<CloudEntry>, String> {
    if let Some(query) = query.filter(|item| !item.trim().is_empty()) {
        let body = dropbox_post(
            client,
            token,
            "https://api.dropboxapi.com/2/files/search_v2",
            json!({
                "query": query,
                "options": {
                    "path": folder.unwrap_or(""),
                    "max_results": 100,
                    "file_status": "active"
                }
            }),
        )
        .await?;

        return Ok(body
            .get("matches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("metadata"))
            .filter_map(|metadata| {
                metadata
                    .get("metadata")
                    .and_then(dropbox_entry)
                    .or_else(|| dropbox_entry(metadata))
            })
            .collect());
    }

    let body = dropbox_post(
        client,
        token,
        "https://api.dropboxapi.com/2/files/list_folder",
        json!({
            "path": folder.unwrap_or(""),
            "recursive": false,
            "include_deleted": false,
            "limit": 100
        }),
    )
    .await?;

    Ok(body
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(dropbox_entry)
        .collect())
}

fn onedrive_entry(item: &Value) -> Option<CloudEntry> {
    let id = string_field(item, "id")?;
    let name = string_field(item, "name")?;
    let is_folder = item.get("folder").is_some();
    let mime_type = item
        .get("file")
        .and_then(|file| file.get("mimeType"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Some(CloudEntry {
        id,
        name,
        size: u64_field(item, "size"),
        mime_type,
        is_folder,
        path: item
            .get("parentReference")
            .and_then(|parent| parent.get("path"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        modified_at: string_field(item, "lastModifiedDateTime"),
    })
}

async fn onedrive_list(
    client: &Client,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<CloudEntry>, String> {
    let mut url = Url::parse("https://graph.microsoft.com/v1.0/me/drive/root")
        .map_err(|error| error.to_string())?;

    let path = if let Some(query) = query.filter(|item| !item.trim().is_empty()) {
        format!(
            "/v1.0/me/drive/root/search(q='{}')",
            query.replace(''', "''")
        )
    } else if let Some(folder) = folder.filter(|item| !item.is_empty()) {
        format!("/v1.0/me/drive/items/{folder}/children")
    } else {
        "/v1.0/me/drive/root/children".to_string()
    };

    url.set_path(&path);
    url.query_pairs_mut().append_pair(
        "$select",
        "id,name,size,file,folder,parentReference,lastModifiedDateTime",
    );

    let response = client
        .get(url)
        .header(AUTHORIZATION, bearer(token))
        .send()
        .await
        .map_err(|error| format!("OneDrive request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "OneDrive returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid OneDrive response: {error}"))?;

    Ok(body
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(onedrive_entry)
        .collect())
}

async fn list_or_search(
    provider: &str,
    token: &str,
    folder: Option<&str>,
    query: Option<&str>,
) -> Result<CloudListResult, String> {
    let provider = provider_id(provider)?;
    if token.trim().is_empty() {
        return Err("Cloud access token is empty.".to_string());
    }

    let client = client()?;
    let entries = match provider {
        "google-drive" => google_list(&client, token, folder, query).await?,
        "dropbox" => dropbox_list(&client, token, folder, query).await?,
        "onedrive" => onedrive_list(&client, token, folder, query).await?,
        _ => unreachable!(),
    };

    Ok(CloudListResult {
        provider: provider.to_string(),
        entries,
    })
}

#[tauri::command]
pub async fn resource_cloud_list(
    provider: String,
    access_token: String,
    folder: Option<String>,
) -> Result<CloudListResult, String> {
    list_or_search(
        &provider,
        &access_token,
        folder.as_deref(),
        None,
    )
    .await
}

#[tauri::command]
pub async fn resource_cloud_search(
    provider: String,
    access_token: String,
    query: String,
    folder: Option<String>,
) -> Result<CloudListResult, String> {
    list_or_search(
        &provider,
        &access_token,
        folder.as_deref(),
        Some(&query),
    )
    .await
}

async fn cloud_download_request(
    provider: &str,
    token: &str,
    file_id: &str,
    file_path: Option<&str>,
) -> Result<(Client, reqwest::RequestBuilder, String), String> {
    let client = client()?;

    match provider {
        "google-drive" => {
            let url = format!(
                "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                file_id
            );
            let request = client
                .get(&url)
                .header(AUTHORIZATION, bearer(token));
            Ok((client, request, url))
        }
        "onedrive" => {
            let url = format!(
                "https://graph.microsoft.com/v1.0/me/drive/items/{}/content",
                file_id
            );
            let request = client
                .get(&url)
                .header(AUTHORIZATION, bearer(token));
            Ok((client, request, url))
        }
        "dropbox" => {
            let path = file_path
                .filter(|item| !item.is_empty())
                .ok_or_else(|| {
                    "Dropbox downloads require the file path.".to_string()
                })?;
            let body = dropbox_post(
                &client,
                token,
                "https://api.dropboxapi.com/2/files/get_temporary_link",
                json!({ "path": path }),
            )
            .await?;
            let link = body
                .get("link")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    "Dropbox did not return a temporary download link."
                        .to_string()
                })?
                .to_string();
            let request = client.get(&link);
            Ok((client, request, link))
        }
        _ => Err("Unsupported cloud provider.".to_string()),
    }
}

async fn run_cloud_download(
    app: AppHandle,
    manager: CloudTransferManager,
    control: Arc<AtomicU8>,
    job_id: String,
    provider: String,
    token: String,
    file_id: String,
    file_path: Option<String>,
    file_name: String,
) -> Result<(), String> {
    let provider = provider_id(&provider)?.to_string();
    let (_, mut request, download_url) = cloud_download_request(
        &provider,
        &token,
        &file_id,
        file_path.as_deref(),
    )
    .await?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let dir = app_data
        .join("resource-cloud")
        .join(safe_job_component(&job_id));
    fs::create_dir_all(&dir)
        .await
        .map_err(|error| format!("Unable to create cloud transfer directory: {error}"))?;

    let name = safe_name(&file_name);
    let part_path = dir.join(format!("{name}.part"));
    let existing = fs::metadata(&part_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Cloud download failed: {error}"))?;

    if !response.status().is_success()
        && response.status() != StatusCode::PARTIAL_CONTENT
    {
        return Err(format!(
            "Cloud download returned HTTP {}.",
            response.status().as_u16()
        ));
    }

    let resumed = existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    let mut completed = if resumed { existing } else { 0 };
    let response_length = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let total = response_length.map(|length| {
        if resumed {
            length.saturating_add(existing)
        } else {
            length
        }
    });
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).to_string());

    if let Some(total) = total {
        if total > MAX_DOWNLOAD_BYTES {
            return Err("Cloud resource exceeds the configured size limit.".to_string());
        }
    }

    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if resumed {
        options.append(true);
    } else {
        options.truncate(true);
    }

    let mut file = options
        .open(&part_path)
        .await
        .map_err(|error| format!("Unable to open cloud transfer file: {error}"))?;

    let started = Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let signal = control.load(Ordering::Relaxed);

        if signal == CONTROL_PAUSE {
            file.flush()
                .await
                .map_err(|error| format!("Unable to flush paused cloud transfer: {error}"))?;
            let mut event = transfer_event(&job_id, "paused", total, completed);
            event.file_name = Some(name.clone());
            event.final_url = Some(download_url.clone());
            emit_event(&app, event);
            manager.remove(&job_id).await;
            return Ok(());
        }

        if signal == CONTROL_CANCEL {
            drop(file);
            let _ = fs::remove_dir_all(&dir).await;
            let mut event = transfer_event(&job_id, "canceled", total, completed);
            event.file_name = Some(name.clone());
            event.final_url = Some(download_url.clone());
            emit_event(&app, event);
            manager.remove(&job_id).await;
            return Ok(());
        }

        let chunk = chunk
            .map_err(|error| format!("Unable to read cloud response: {error}"))?;
        completed = completed.saturating_add(chunk.len() as u64);

        if completed > MAX_DOWNLOAD_BYTES {
            return Err("Cloud transfer exceeded the configured size limit.".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Unable to write cloud transfer file: {error}"))?;

        let mut event = transfer_event(&job_id, "running", total, completed);
        let seconds = started.elapsed().as_secs_f64();
        if seconds > 0.0 {
            event.download_rate = Some(
                completed.saturating_sub(if resumed { existing } else { 0 }) as f64
                    / seconds,
            );
        }
        event.file_name = Some(name.clone());
        event.content_type = content_type.clone();
        event.final_url = Some(download_url.clone());
        emit_event(&app, event);
    }

    file.flush()
        .await
        .map_err(|error| format!("Unable to finish cloud transfer: {error}"))?;
    drop(file);

    let validation_path = part_path.clone();
    let detected_format = match tauri::async_runtime::spawn_blocking(move || {
        validate_downloaded_book(&validation_path)
    })
    .await
    {
        Ok(Ok(format)) => format,
        Ok(Err(error)) => {
            let _ = fs::remove_dir_all(&dir).await;
            return Err(error);
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&dir).await;
            return Err(format!("Unable to validate cloud download: {error}"));
        }
    };

    let current_ext = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let final_name = if current_ext.as_deref() == Some(detected_format.as_str()) {
        name.clone()
    } else {
        let stem = Path::new(&name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("download");
        format!("{}.{}", safe_name(stem), detected_format)
    };
    let final_path = dir.join(&final_name);

    fs::rename(&part_path, &final_path)
        .await
        .map_err(|error| format!("Unable to finalize cloud file: {error}"))?;

    let mut event = transfer_event(&job_id, "downloaded", total, completed);
    event.progress = 1.0;
    event.temp_path = Some(final_path.to_string_lossy().to_string());
    event.file_name = Some(final_name);
    event.content_type = content_type;
    event.final_url = Some(download_url);
    event.detected_format = Some(detected_format);
    emit_event(&app, event);

    manager.remove(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn resource_cloud_start_download(
    app: AppHandle,
    manager: State<'_, CloudTransferManager>,
    job_id: String,
    provider: String,
    access_token: String,
    file_id: String,
    file_path: Option<String>,
    file_name: String,
) -> Result<bool, String> {
    let provider = provider_id(&provider)?.to_string();
    let manager = manager.inner().clone();
    let control = manager.register(&job_id).await?;
    let spawned_manager = manager.clone();
    let spawned_app = app.clone();
    let spawned_job = job_id.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_cloud_download(
            spawned_app.clone(),
            spawned_manager.clone(),
            control,
            spawned_job.clone(),
            provider,
            access_token,
            file_id,
            file_path,
            file_name,
        )
        .await
        {
            let mut event = transfer_event(&spawned_job, "failed", None, 0);
            event.error = Some(error);
            emit_event(&spawned_app, event);
            spawned_manager.remove(&spawned_job).await;
        }
    });

    Ok(true)
}

#[tauri::command]
pub async fn resource_cloud_pause(
    manager: State<'_, CloudTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_PAUSE).await)
}

#[tauri::command]
pub async fn resource_cloud_cancel(
    manager: State<'_, CloudTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_CANCEL).await)
}

#[tauri::command]
pub async fn resource_cloud_cleanup(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let target = app_data
        .join("resource-cloud")
        .join(safe_job_component(&job_id));

    if !target.exists() {
        return Ok(false);
    }

    fs::remove_dir_all(&target)
        .await
        .map_err(|error| format!("Unable to clean cloud files: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_cloud_provider_ids() {
        assert_eq!(provider_id("google-drive").unwrap(), "google-drive");
        assert_eq!(provider_id("dropbox").unwrap(), "dropbox");
        assert_eq!(provider_id("onedrive").unwrap(), "onedrive");
        assert!(provider_id("unknown").is_err());
    }
}

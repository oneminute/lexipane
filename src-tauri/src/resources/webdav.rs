use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use futures_util::StreamExt;
use reqwest::{
    header::{ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, RANGE},
    Client, Method, StatusCode, Url,
};
use roxmltree::Document;
use serde::Serialize;
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
pub struct WebDavEntry {
    pub id: String,
    pub name: String,
    pub href: String,
    pub size: Option<u64>,
    pub mime_type: Option<String>,
    pub is_folder: bool,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavListResult {
    pub base_url: String,
    pub path: String,
    pub entries: Vec<WebDavEntry>,
}

#[derive(Clone, Default)]
pub struct WebDavTransferManager {
    controls: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

impl WebDavTransferManager {
    async fn register(&self, job_id: &str) -> Result<Arc<AtomicU8>, String> {
        let mut controls = self.controls.lock().await;
        if controls.contains_key(job_id) {
            return Err("This WebDAV transfer is already running.".to_string());
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
        .map_err(|error| format!("Unable to initialize WebDAV client: {error}"))
}

fn validate_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim())
        .map_err(|error| format!("Invalid WebDAV URL: {error}"))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("WebDAV base URL must use http:// or https://.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Put WebDAV credentials in the account fields, not inside the URL."
                .to_string(),
        );
    }

    Ok(url)
}

fn validate_base_url(value: &str) -> Result<Url, String> {
    let mut url = validate_http_url(value)?;

    if !url.path().ends_with('/') {
        let next = format!("{}/", url.path());
        url.set_path(&next);
    }

    Ok(url)
}

fn resolve_url(base_url: &str, path_or_url: Option<&str>) -> Result<Url, String> {
    let base = validate_base_url(base_url)?;
    let Some(value) = path_or_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(base);
    };

    if let Ok(url) = Url::parse(value) {
        if url.scheme() != "http" && url.scheme() != "https" {
            return Err("WebDAV resource URL must use HTTP or HTTPS.".to_string());
        }
        return Ok(url);
    }

    base.join(value)
        .map_err(|error| format!("Unable to resolve WebDAV path: {error}"))
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

fn basic_auth(
    request: reqwest::RequestBuilder,
    username: &str,
    password: Option<&str>,
) -> reqwest::RequestBuilder {
    if username.trim().is_empty() {
        request
    } else {
        request.basic_auth(username.trim(), password)
    }
}

fn descendant_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.descendants()
        .find(|child| child.is_element() && child.tag_name().name().eq_ignore_ascii_case(name))
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn response_is_collection(node: roxmltree::Node<'_, '_>) -> bool {
    node.descendants()
        .any(|child| child.is_element() && child.tag_name().name().eq_ignore_ascii_case("collection"))
}

fn name_from_href(href: &str) -> String {
    let without_query = href.split('?').next().unwrap_or(href);
    let segment = without_query
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("resource");

    urlencoding::decode(segment)
        .map(|value| value.to_string())
        .unwrap_or_else(|_| segment.to_string())
}

fn parse_propfind(
    xml: &str,
    requested_url: &Url,
) -> Result<Vec<WebDavEntry>, String> {
    let document = Document::parse(xml)
        .map_err(|error| format!("WebDAV server returned invalid XML: {error}"))?;
    let requested_path = requested_url.path().trim_end_matches('/');

    let mut entries = Vec::new();

    for response in document.descendants().filter(|node| {
        node.is_element() && node.tag_name().name().eq_ignore_ascii_case("response")
    }) {
        let Some(raw_href) = descendant_text(response, "href") else {
            continue;
        };

        let resolved = requested_url
            .join(&raw_href)
            .or_else(|_| Url::parse(&raw_href))
            .map_err(|error| format!("Unable to resolve WebDAV entry URL: {error}"))?;

        if resolved.path().trim_end_matches('/') == requested_path {
            continue;
        }

        let is_folder = response_is_collection(response);
        let display_name = descendant_text(response, "displayname")
            .unwrap_or_else(|| name_from_href(resolved.path()));
        let size = descendant_text(response, "getcontentlength")
            .and_then(|value| value.parse::<u64>().ok());
        let mime_type = descendant_text(response, "getcontenttype");
        let modified_at = descendant_text(response, "getlastmodified");

        entries.push(WebDavEntry {
            id: resolved.to_string(),
            name: display_name,
            href: resolved.to_string(),
            size,
            mime_type,
            is_folder,
            modified_at,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_folder
            .cmp(&left.is_folder)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn resource_webdav_list(
    base_url: String,
    username: String,
    password: Option<String>,
    path: Option<String>,
) -> Result<WebDavListResult, String> {
    let url = resolve_url(&base_url, path.as_deref())?;
    let client = client()?;
    let method = Method::from_bytes(b"PROPFIND")
        .map_err(|error| format!("Unable to create WebDAV request: {error}"))?;

    let body = r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <d:getcontentlength />
    <d:getcontenttype />
    <d:getlastmodified />
  </d:prop>
</d:propfind>"#;

    let request = client
        .request(method, url.clone())
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(body);

    let response = basic_auth(request, &username, password.as_deref())
        .send()
        .await
        .map_err(|error| format!("WebDAV browse failed: {error}"))?;

    if response.status().as_u16() != 207 && !response.status().is_success() {
        return Err(format!(
            "WebDAV browse returned status {}.",
            response.status().as_u16()
        ));
    }

    let xml = response
        .text()
        .await
        .map_err(|error| format!("Unable to read WebDAV response: {error}"))?;
    let entries = parse_propfind(&xml, &url)?;

    Ok(WebDavListResult {
        base_url: validate_base_url(&base_url)?.to_string(),
        path: url.to_string(),
        entries,
    })
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

async fn job_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-webdav")
        .join(safe_job_component(job_id));

    fs::create_dir_all(&root)
        .await
        .map_err(|error| format!("Unable to create WebDAV transfer directory: {error}"))?;
    Ok(root)
}

async fn run_download(
    app: AppHandle,
    manager: WebDavTransferManager,
    control: Arc<AtomicU8>,
    job_id: String,
    file_url: String,
    username: String,
    password: Option<String>,
    file_name: String,
) -> Result<(), String> {
    let url = validate_http_url(&file_url)?;
    let client = client()?;
    let dir = job_dir(&app, &job_id).await?;
    let name = safe_name(&file_name);
    let part_path = dir.join(format!("{name}.part"));
    let existing = fs::metadata(&part_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let mut request = client
        .get(url.clone())
        .header(ACCEPT_ENCODING, "identity");
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    request = basic_auth(request, &username, password.as_deref());

    let response = request
        .send()
        .await
        .map_err(|error| format!("WebDAV download failed: {error}"))?;

    if !response.status().is_success()
        && response.status() != StatusCode::PARTIAL_CONTENT
    {
        return Err(format!(
            "WebDAV download returned status {}.",
            response.status().as_u16()
        ));
    }

    let resumed = existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    let mut completed = if resumed { existing } else { 0 };
    let response_length = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.content_length());
    let total = response_length.map(|length| {
        if resumed {
            length.saturating_add(existing)
        } else {
            length
        }
    });

    if total.unwrap_or(0) > MAX_DOWNLOAD_BYTES {
        return Err("WebDAV file exceeds the 2 GiB transfer limit.".to_string());
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

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
        .map_err(|error| format!("Unable to open WebDAV transfer file: {error}"))?;

    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        match control.load(Ordering::Relaxed) {
            CONTROL_PAUSE => {
                file.flush()
                    .await
                    .map_err(|error| format!("Unable to flush paused WebDAV transfer: {error}"))?;
                let mut event = transfer_event(&job_id, "paused", total, completed);
                event.file_name = Some(name.clone());
                event.final_url = Some(url.to_string());
                emit_event(&app, event);
                manager.remove(&job_id).await;
                return Ok(());
            }
            CONTROL_CANCEL => {
                drop(file);
                let _ = fs::remove_dir_all(&dir).await;
                let mut event = transfer_event(&job_id, "canceled", total, completed);
                event.file_name = Some(name.clone());
                event.final_url = Some(url.to_string());
                emit_event(&app, event);
                manager.remove(&job_id).await;
                return Ok(());
            }
            _ => {}
        }

        let chunk = chunk
            .map_err(|error| format!("Unable to read WebDAV response: {error}"))?;
        completed = completed.saturating_add(chunk.len() as u64);

        if completed > MAX_DOWNLOAD_BYTES {
            let _ = fs::remove_dir_all(&dir).await;
            return Err("WebDAV transfer exceeded the 2 GiB limit.".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Unable to write WebDAV transfer: {error}"))?;

        if last_emit.elapsed().as_millis() >= 250 {
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
            event.final_url = Some(url.to_string());
            emit_event(&app, event);
            last_emit = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|error| format!("Unable to finish WebDAV transfer: {error}"))?;
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
            return Err(format!("Unable to validate WebDAV download: {error}"));
        }
    };

    let current_extension = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    let final_name =
        if current_extension.as_deref() == Some(detected_format.as_str()) {
            name.clone()
        } else {
            let stem = Path::new(&name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("download");
            format!("{}.{}", safe_name(stem), detected_format)
        };

    let final_path = dir.join(&final_name);
    if final_path.exists() {
        let _ = fs::remove_file(&final_path).await;
    }

    fs::rename(&part_path, &final_path)
        .await
        .map_err(|error| format!("Unable to finalize WebDAV transfer: {error}"))?;

    let mut event = transfer_event(&job_id, "downloaded", total, completed);
    event.progress = 1.0;
    event.temp_path = Some(final_path.to_string_lossy().to_string());
    event.file_name = Some(final_name);
    event.content_type = content_type;
    event.final_url = Some(url.to_string());
    event.detected_format = Some(detected_format);
    emit_event(&app, event);

    manager.remove(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn resource_webdav_start_download(
    app: AppHandle,
    manager: State<'_, WebDavTransferManager>,
    job_id: String,
    file_url: String,
    username: String,
    password: Option<String>,
    file_name: String,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    let control = manager.register(&job_id).await?;
    let spawned_manager = manager.clone();
    let spawned_job_id = job_id.clone();
    let spawned_app = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_download(
            spawned_app.clone(),
            spawned_manager.clone(),
            control,
            spawned_job_id.clone(),
            file_url,
            username,
            password,
            file_name,
        )
        .await
        {
            let mut event = transfer_event(&spawned_job_id, "failed", None, 0);
            event.error = Some(error);
            emit_event(&spawned_app, event);
            spawned_manager.remove(&spawned_job_id).await;
        }
    });

    Ok(true)
}

#[tauri::command]
pub async fn resource_webdav_pause(
    manager: State<'_, WebDavTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_PAUSE).await)
}

#[tauri::command]
pub async fn resource_webdav_cancel(
    manager: State<'_, WebDavTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_CANCEL).await)
}

#[tauri::command]
pub async fn resource_webdav_cleanup(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-webdav")
        .join(safe_job_component(&job_id));

    if !root.exists() {
        return Ok(false);
    }

    fs::remove_dir_all(&root)
        .await
        .map_err(|error| format!("Unable to clean WebDAV transfer files: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_webdav_urls() {
        assert!(validate_base_url("https://example.test/dav").is_ok());
        assert_eq!(
            validate_http_url("https://example.test/dav/book.epub")
                .unwrap()
                .path(),
            "/dav/book.epub"
        );
        assert!(validate_base_url("webdav://example.test/dav").is_err());
        assert!(validate_base_url("ftp://example.test/dav").is_err());
    }

    #[test]
    fn parses_multistatus_entries() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/</d:href>
    <d:propstat><d:prop><d:displayname>Root</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/book.epub</d:href>
    <d:propstat><d:prop><d:displayname>book.epub</d:displayname><d:getcontentlength>1234</d:getcontentlength><d:getcontenttype>application/epub+zip</d:getcontenttype><d:resourcetype/></d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;

        let url = Url::parse("https://example.test/dav/").unwrap();
        let entries = parse_propfind(xml, &url).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "book.epub");
        assert_eq!(entries[0].size, Some(1234));
        assert!(!entries[0].is_folder);
    }
}

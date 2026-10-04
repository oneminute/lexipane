use futures_util::StreamExt;
use reqwest::{
    header::{
        ACCEPT_ENCODING, ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH,
        CONTENT_RANGE, CONTENT_TYPE, RANGE,
    },
    Client, StatusCode, Url,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::File as StdFile,
    io::Read,
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

const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;
const EVENT_NAME: &str = "resource-transfer-event";

const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSE: u8 = 1;
const CONTROL_CANCEL: u8 = 2;

#[derive(Clone, Default)]
pub struct HttpTransferManager {
    controls: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

impl HttpTransferManager {
    async fn register(&self, job_id: &str) -> Result<Arc<AtomicU8>, String> {
        let mut controls = self.controls.lock().await;

        if controls.contains_key(job_id) {
            return Err("This transfer job is already running.".to_string());
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpProbeResult {
    pub final_url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub accept_ranges: bool,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTextResponse {
    pub final_url: String,
    pub content_type: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTransferStartResult {
    pub job_id: String,
    pub started: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceTransferEvent {
    pub job_id: String,
    pub state: String,
    pub bytes_total: Option<u64>,
    pub bytes_completed: u64,
    pub progress: f64,
    pub download_rate: Option<f64>,
    pub temp_path: Option<String>,
    pub file_name: Option<String>,
    pub content_type: Option<String>,
    pub final_url: Option<String>,
    pub detected_format: Option<String>,
    pub error: Option<String>,
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("LexiPane/0.1 ResourceHub")
        .build()
        .map_err(|error| format!("Unable to initialize HTTP client: {error}"))
}

fn validate_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim())
        .map_err(|error| format!("Invalid HTTP resource URL: {error}"))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Only http:// and https:// resource URLs are allowed.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Embedded URL credentials are not allowed. Use a provider account or secure credential flow."
                .to_string(),
        );
    }

    Ok(url)
}

fn validate_redirect_target(
    original: &Url,
    final_url: &Url,
) -> Result<(), String> {
    if original.scheme() == "https" && final_url.scheme() != "https" {
        return Err(
            "Refusing to downgrade an HTTPS resource to an insecure redirect."
                .to_string(),
        );
    }

    if !final_url.username().is_empty() || final_url.password().is_some() {
        return Err(
            "Redirected URLs with embedded credentials are not allowed."
                .to_string(),
        );
    }

    Ok(())
}

fn sanitize_file_name(value: &str) -> String {
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
    let candidate = if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    };

    candidate.chars().take(180).collect()
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

fn file_name_from_disposition(value: Option<&str>) -> Option<String> {
    let value = value?;

    for part in value.split(';').skip(1) {
        let trimmed = part.trim();

        if let Some(raw) = trimmed.strip_prefix("filename=") {
            let raw = raw.trim().trim_matches('"');
            if !raw.is_empty() {
                return Some(sanitize_file_name(raw));
            }
        }
    }

    None
}

fn file_name_from_url(url: &Url) -> Option<String> {
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|value| !value.is_empty())
        .map(sanitize_file_name)
}

fn default_name_for_content_type(content_type: Option<&str>) -> String {
    match content_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        value if value.contains("application/pdf") => "download.pdf".to_string(),
        value if value.contains("application/epub+zip") => "download.epub".to_string(),
        _ => "download".to_string(),
    }
}

async fn probe_with_client(client: &Client, url: Url) -> Result<HttpProbeResult, String> {
    let mut response = client
        .head(url.clone())
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|error| format!("HTTP probe failed: {error}"))?;

    if response.status() == StatusCode::METHOD_NOT_ALLOWED
        || response.status() == StatusCode::FORBIDDEN
        || response.status() == StatusCode::NOT_IMPLEMENTED
    {
        response = client
            .get(url.clone())
            .header(ACCEPT_ENCODING, "identity")
            .header(RANGE, "bytes=0-0")
            .send()
            .await
            .map_err(|error| format!("HTTP range probe failed: {error}"))?;
    }

    if !response.status().is_success()
        && response.status() != StatusCode::PARTIAL_CONTENT
    {
        return Err(format!(
            "HTTP probe returned status {}.",
            response.status().as_u16()
        ));
    }

    let final_url = response.url().clone();
    validate_redirect_target(&url, &final_url)?;
    let headers = response.headers();

    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

    let content_length = headers
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| {
            headers
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
        });

    let accept_ranges = headers
        .get(ACCEPT_RANGES)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("bytes"))
        .unwrap_or(response.status() == StatusCode::PARTIAL_CONTENT);

    let file_name = file_name_from_disposition(
        headers
            .get(CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok()),
    )
    .or_else(|| file_name_from_url(&final_url));

    Ok(HttpProbeResult {
        final_url: final_url.to_string(),
        status: response.status().as_u16(),
        content_type,
        content_length,
        accept_ranges,
        file_name,
    })
}

#[tauri::command]
pub async fn resource_http_probe(url: String) -> Result<HttpProbeResult, String> {
    let url = validate_http_url(&url)?;
    let client = build_client()?;
    probe_with_client(&client, url).await
}

#[tauri::command]
pub async fn resource_http_fetch_text(
    url: String,
    max_bytes: Option<usize>,
) -> Result<HttpTextResponse, String> {
    let url = validate_http_url(&url)?;
    let original_url = url.clone();
    let client = build_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Unable to fetch resource text: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Resource text request returned status {}.",
            response.status().as_u16()
        ));
    }

    validate_redirect_target(&original_url, response.url())?;
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());

    let limit = max_bytes.unwrap_or(MAX_TEXT_BYTES).min(MAX_TEXT_BYTES);

    if let Some(length) = response.content_length() {
        if length as usize > limit {
            return Err(format!(
                "Resource text is too large to inspect ({} bytes; limit {}).",
                length, limit
            ));
        }
    }

    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| format!("Unable to read resource text: {error}"))?;

        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(format!(
                "Resource text is too large to inspect (limit {} bytes).",
                limit
            ));
        }

        bytes.extend_from_slice(&chunk);
    }

    let body = String::from_utf8(bytes)
        .map_err(|_| "Resource text is not valid UTF-8.".to_string())?;

    Ok(HttpTextResponse {
        final_url,
        content_type,
        body,
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

fn validate_downloaded_book(path: &Path) -> Result<String, String> {
    let mut file = StdFile::open(path)
        .map_err(|error| format!("Unable to open downloaded file for validation: {error}"))?;
    let mut prefix = [0_u8; 8];
    let read = file
        .read(&mut prefix)
        .map_err(|error| format!("Unable to validate downloaded file: {error}"))?;

    if read >= 5 && &prefix[..5] == b"%PDF-" {
        return Ok("pdf".to_string());
    }

    if read >= 4 && &prefix[..2] == b"PK" {
        let archive_file = StdFile::open(path)
            .map_err(|error| format!("Unable to inspect EPUB archive: {error}"))?;
        let mut archive = zip::ZipArchive::new(archive_file)
            .map_err(|_| "Downloaded ZIP is not a valid EPUB archive.".to_string())?;

        if let Ok(mut mimetype) = archive.by_name("mimetype") {
            let mut value = String::new();
            mimetype
                .read_to_string(&mut value)
                .map_err(|error| format!("Unable to read EPUB mimetype: {error}"))?;

            if value.trim() == "application/epub+zip" {
                return Ok("epub".to_string());
            }
        }

        if archive.by_name("META-INF/container.xml").is_ok() {
            return Ok("epub".to_string());
        }
    }

    Err("Downloaded content is not a supported PDF or EPUB file.".to_string())
}

async fn transfer_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let dir = app_data
        .join("resource-transfers")
        .join(safe_job_component(job_id));

    fs::create_dir_all(&dir)
        .await
        .map_err(|error| format!("Unable to create transfer directory: {error}"))?;

    Ok(dir)
}

async fn finalize_downloaded_part(
    dir: &Path,
    part_path: &Path,
    name: &str,
) -> Result<(PathBuf, String, String), String> {
    let validation_path = part_path.to_path_buf();
    let detected_format = match tauri::async_runtime::spawn_blocking(move || {
        validate_downloaded_book(&validation_path)
    })
    .await
    {
        Ok(Ok(format)) => format,
        Ok(Err(error)) => {
            let _ = fs::remove_dir_all(dir).await;
            return Err(error);
        }
        Err(error) => {
            let _ = fs::remove_dir_all(dir).await;
            return Err(format!(
                "Unable to validate downloaded file: {error}"
            ));
        }
    };

    let current_extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    let final_name =
        if current_extension.as_deref() == Some(detected_format.as_str()) {
            name.to_string()
        } else {
            let stem = Path::new(name)
                .file_stem()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty())
                .unwrap_or("download");
            format!("{}.{}", sanitize_file_name(stem), detected_format)
        };

    let final_path = dir.join(&final_name);

    if final_path.exists() {
        fs::remove_file(&final_path)
            .await
            .map_err(|error| {
                format!("Unable to replace previous transfer result: {error}")
            })?;
    }

    fs::rename(part_path, &final_path)
        .await
        .map_err(|error| {
            format!("Unable to finalize transfer file: {error}")
        })?;

    Ok((final_path, final_name, detected_format))
}

async fn run_http_download(
    app: AppHandle,
    manager: HttpTransferManager,
    control: Arc<AtomicU8>,
    job_id: String,
    url: Url,
    file_name_hint: Option<String>,
) -> Result<(), String> {
    let client = build_client()?;
    let probe = probe_with_client(&client, url).await?;

    if let Some(length) = probe.content_length {
        if length > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "Resource is too large ({} bytes; limit {}).",
                length, MAX_DOWNLOAD_BYTES
            ));
        }
    }

    let dir = transfer_dir(&app, &job_id).await?;
    let name = sanitize_file_name(
        file_name_hint
            .as_deref()
            .or(probe.file_name.as_deref())
            .unwrap_or_else(|| {
                if probe.content_type.is_some() {
                    ""
                } else {
                    "download"
                }
            }),
    );

    let name = if name == "download" || name.is_empty() {
        default_name_for_content_type(probe.content_type.as_deref())
    } else {
        name
    };

    let part_path = dir.join(format!("{name}.part"));
    let mut existing = fs::metadata(&part_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if existing > MAX_DOWNLOAD_BYTES {
        return Err("Existing partial transfer exceeds the configured size limit.".to_string());
    }

    if let Some(total) = probe.content_length {
        if existing > total {
            fs::remove_file(&part_path)
                .await
                .map_err(|error| {
                    format!(
                        "Unable to reset an oversized partial transfer: {error}"
                    )
                })?;
            existing = 0;
        }

        let remaining = total.saturating_sub(existing);
        let available = fs2::available_space(&dir)
            .map_err(|error| format!("Unable to check free disk space: {error}"))?;

        if available < remaining.saturating_add(16 * 1024 * 1024) {
            return Err("Not enough free disk space for this transfer.".to_string());
        }

        if existing > 0 && existing == total {
            let mut event =
                transfer_event(&job_id, "running", Some(total), existing);
            event.file_name = Some(name.clone());
            event.content_type = probe.content_type.clone();
            event.final_url = Some(probe.final_url.clone());
            emit_event(&app, event);

            let (final_path, final_name, detected_format) =
                finalize_downloaded_part(&dir, &part_path, &name).await?;

            let mut event =
                transfer_event(&job_id, "downloaded", Some(total), total);
            event.progress = 1.0;
            event.temp_path =
                Some(final_path.to_string_lossy().to_string());
            event.file_name = Some(final_name);
            event.content_type = probe.content_type;
            event.final_url = Some(probe.final_url);
            event.detected_format = Some(detected_format);
            emit_event(&app, event);

            manager.remove(&job_id).await;
            return Ok(());
        }
    }

    let mut request = client
        .get(&probe.final_url)
        .header(ACCEPT_ENCODING, "identity");
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("HTTP download failed: {error}"))?;

    if !response.status().is_success()
        && response.status() != StatusCode::PARTIAL_CONTENT
    {
        return Err(format!(
            "HTTP download returned status {}.",
            response.status().as_u16()
        ));
    }

    let resumed = existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    let mut completed = if resumed { existing } else { 0 };

    let total = if resumed {
        probe.content_length.or_else(|| {
            response
                .content_length()
                .map(|remaining| remaining.saturating_add(existing))
        })
    } else {
        probe.content_length.or_else(|| response.content_length())
    };

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
        .map_err(|error| format!("Unable to open transfer file: {error}"))?;

    let mut started_event = transfer_event(&job_id, "running", total, completed);
    started_event.file_name = Some(name.clone());
    started_event.content_type = probe.content_type.clone();
    started_event.final_url = Some(probe.final_url.clone());
    emit_event(&app, started_event);

    let started_at = Instant::now();
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let control_value = control.load(Ordering::Relaxed);

        if control_value == CONTROL_PAUSE {
            file.flush()
                .await
                .map_err(|error| format!("Unable to flush paused transfer: {error}"))?;

            let mut event = transfer_event(&job_id, "paused", total, completed);
            event.file_name = Some(name.clone());
            event.content_type = probe.content_type.clone();
            event.final_url = Some(probe.final_url.clone());
            emit_event(&app, event);
            manager.remove(&job_id).await;
            return Ok(());
        }

        if control_value == CONTROL_CANCEL {
            drop(file);
            let _ = fs::remove_dir_all(&dir).await;

            let mut event = transfer_event(&job_id, "canceled", total, completed);
            event.file_name = Some(name.clone());
            event.content_type = probe.content_type.clone();
            event.final_url = Some(probe.final_url.clone());
            emit_event(&app, event);
            manager.remove(&job_id).await;
            return Ok(());
        }

        let chunk = chunk.map_err(|error| format!("Unable to read HTTP response: {error}"))?;

        completed = completed.saturating_add(chunk.len() as u64);

        if completed > MAX_DOWNLOAD_BYTES {
            return Err("Transfer exceeded the configured maximum size.".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Unable to write transfer file: {error}"))?;

        if last_emit.elapsed().as_millis() >= 250 {
            let mut event = transfer_event(&job_id, "running", total, completed);
            let seconds = started_at.elapsed().as_secs_f64();
            if seconds > 0.0 {
                event.download_rate = Some(completed.saturating_sub(if resumed { existing } else { 0 }) as f64 / seconds);
            }
            event.file_name = Some(name.clone());
            event.content_type = probe.content_type.clone();
            event.final_url = Some(probe.final_url.clone());
            emit_event(&app, event);
            last_emit = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|error| format!("Unable to finish transfer file: {error}"))?;
    drop(file);

    let (final_path, final_name, detected_format) =
        finalize_downloaded_part(&dir, &part_path, &name).await?;

    let mut event = transfer_event(&job_id, "downloaded", total, completed);
    event.progress = 1.0;
    event.temp_path = Some(final_path.to_string_lossy().to_string());
    event.file_name = Some(final_name);
    event.content_type = probe.content_type;
    event.final_url = Some(probe.final_url);
    event.detected_format = Some(detected_format);
    emit_event(&app, event);

    manager.remove(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn resource_http_start_download(
    app: AppHandle,
    manager: State<'_, HttpTransferManager>,
    job_id: String,
    url: String,
    file_name_hint: Option<String>,
) -> Result<HttpTransferStartResult, String> {
    let url = validate_http_url(&url)?;
    let manager = manager.inner().clone();
    let control = manager.register(&job_id).await?;
    let spawned_manager = manager.clone();
    let spawned_job_id = job_id.clone();
    let spawned_app = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_http_download(
            spawned_app.clone(),
            spawned_manager.clone(),
            control,
            spawned_job_id.clone(),
            url,
            file_name_hint,
        )
        .await
        {
            let mut event = transfer_event(&spawned_job_id, "failed", None, 0);
            event.error = Some(error);
            emit_event(&spawned_app, event);
            spawned_manager.remove(&spawned_job_id).await;
        }
    });

    Ok(HttpTransferStartResult {
        job_id,
        started: true,
    })
}

#[tauri::command]
pub async fn resource_http_pause(
    manager: State<'_, HttpTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_PAUSE).await)
}

#[tauri::command]
pub async fn resource_http_cancel(
    manager: State<'_, HttpTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_CANCEL).await)
}

#[tauri::command]
pub async fn resource_http_cleanup_temp(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let root = app_data.join("resource-transfers");
    let target = root.join(safe_job_component(&job_id));

    if !target.exists() {
        return Ok(false);
    }

    fs::remove_dir_all(&target)
        .await
        .map_err(|error| format!("Unable to clean transfer files: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_and_embedded_credentials() {
        assert!(validate_http_url("ftp://example.com/book.epub").is_err());
        assert!(validate_http_url("https://user:pass@example.com/book.epub").is_err());
        assert!(validate_http_url("https://example.com/book.epub").is_ok());

        let secure = Url::parse("https://example.com/book.epub").unwrap();
        let downgraded = Url::parse("http://cdn.example.com/book.epub").unwrap();
        assert!(validate_redirect_target(&secure, &downgraded).is_err());
    }

    #[test]
    fn sanitizes_remote_file_names() {
        assert_eq!(
            sanitize_file_name("bad/..\\book?:name.epub"),
            "bad_.._book__name.epub"
        );
    }

    #[test]
    fn validates_pdf_content_by_signature() {
        let path = std::env::temp_dir().join(format!(
            "lexipane-http-test-{}.pdf",
            std::process::id()
        ));

        std::fs::write(&path, b"%PDF-1.7\n1 0 obj\n")
            .expect("write temporary PDF");
        assert_eq!(
            validate_downloaded_book(&path).expect("valid PDF"),
            "pdf"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_downloaded_content() {
        let path = std::env::temp_dir().join(format!(
            "lexipane-http-test-{}.bin",
            std::process::id()
        ));

        std::fs::write(&path, b"<html>not a book</html>")
            .expect("write temporary file");
        assert!(validate_downloaded_book(&path).is_err());
        let _ = std::fs::remove_file(path);
    }
}

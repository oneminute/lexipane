use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use chrono::Utc;
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use reqwest::{
    header::{ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, RANGE},
    Client, StatusCode, Url,
};
use roxmltree::Document;
use serde::Serialize;
use sha2::{Digest, Sha256};
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

type HmacSha256 = Hmac<Sha256>;

const EVENT_NAME: &str = "resource-transfer-event";
const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSE: u8 = 1;
const CONTROL_CANCEL: u8 = 2;
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_LIST_OBJECTS: usize = 5_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Entry {
    pub id: String,
    pub name: String,
    pub key: String,
    pub size: Option<u64>,
    pub is_folder: bool,
    pub modified_at: Option<String>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct S3ListResult {
    pub bucket: String,
    pub prefix: String,
    pub entries: Vec<S3Entry>,
    pub truncated: bool,
}

#[derive(Clone, Default)]
pub struct S3TransferManager {
    controls: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

impl S3TransferManager {
    async fn register(&self, job_id: &str) -> Result<Arc<AtomicU8>, String> {
        let mut controls = self.controls.lock().await;
        if controls.contains_key(job_id) {
            return Err("This S3 transfer is already running.".to_string());
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

#[derive(Clone)]
struct S3Credentials {
    access_key: String,
    secret_key: String,
    session_token: Option<String>,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("LexiPane/0.1 ResourceHub")
        .build()
        .map_err(|error| format!("Unable to initialize S3 client: {error}"))
}

fn validate_endpoint(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value.trim())
        .map_err(|error| format!("Invalid S3 endpoint: {error}"))?;

    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("S3 endpoint must use https:// or http://.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("S3 endpoint must not contain embedded credentials.".to_string());
    }

    url.set_query(None);
    url.set_fragment(None);

    if !url.path().ends_with('/') {
        let next = format!("{}/", url.path());
        url.set_path(&next);
    }

    Ok(url)
}

fn credentials(
    access_key: &str,
    secret_key: &str,
    session_token: Option<String>,
) -> Result<S3Credentials, String> {
    if access_key.trim().is_empty() || secret_key.is_empty() {
        return Err("S3 access key and secret key are required.".to_string());
    }

    Ok(S3Credentials {
        access_key: access_key.trim().to_string(),
        secret_key: secret_key.to_string(),
        session_token: session_token.filter(|value| !value.is_empty()),
    })
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sha256_hex(value: &[u8]) -> String {
    hex_lower(&Sha256::digest(value))
}

fn hmac(key: &[u8], data: &str) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|_| "Unable to initialize S3 request signer.".to_string())?;
    mac.update(data.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn aws_encode(value: &str, preserve_slash: bool) -> String {
    let mut output = String::new();

    for byte in value.as_bytes() {
        let ch = *byte as char;
        let unreserved =
            ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~');

        if unreserved || (preserve_slash && ch == '/') {
            output.push(ch);
        } else {
            output.push('%');
            output.push_str(&format!("{:02X}", byte));
        }
    }

    output
}

fn canonical_query(params: &[(String, String)]) -> String {
    let mut encoded: Vec<(String, String)> = params
        .iter()
        .map(|(key, value)| (aws_encode(key, false), aws_encode(value, false)))
        .collect();

    encoded.sort();

    encoded
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn host_header(url: &Url) -> Result<String, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "S3 endpoint has no host.".to_string())?;

    Ok(match url.port() {
        Some(port) if !((url.scheme() == "https" && port == 443)
            || (url.scheme() == "http" && port == 80)) =>
        {
            format!("{host}:{port}")
        }
        _ => host.to_string(),
    })
}

fn object_url(endpoint: &str, bucket: &str, key: Option<&str>) -> Result<Url, String> {
    let endpoint = validate_endpoint(endpoint)?;
    let mut base = endpoint.to_string();
    if !base.ends_with('/') {
        base.push('/');
    }

    let mut path = aws_encode(bucket.trim_matches('/'), false);
    if let Some(key) = key.filter(|value| !value.is_empty()) {
        path.push('/');
        path.push_str(&aws_encode(key.trim_start_matches('/'), true));
    }

    Url::parse(&(base + &path))
        .map_err(|error| format!("Unable to build S3 object URL: {error}"))
}

fn signed_get(
    client: &Client,
    mut url: Url,
    region: &str,
    credentials: &S3Credentials,
    query: Vec<(String, String)>,
) -> Result<reqwest::RequestBuilder, String> {
    let region = region.trim();
    if region.is_empty() {
        return Err("S3 region is required.".to_string());
    }

    let canonical_query = canonical_query(&query);
    url.set_query(if canonical_query.is_empty() {
        None
    } else {
        Some(&canonical_query)
    });

    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let payload_hash = sha256_hex(b"");
    let host = host_header(&url)?;

    let mut canonical_headers = format!(
        "host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    );
    let mut signed_headers = "host;x-amz-content-sha256;x-amz-date".to_string();

    if let Some(token) = credentials.session_token.as_deref() {
        canonical_headers.push_str(&format!("x-amz-security-token:{token}\n"));
        signed_headers.push_str(";x-amz-security-token");
    }

    let canonical_request = [
        "GET",
        url.path(),
        &canonical_query,
        &canonical_headers,
        &signed_headers,
        &payload_hash,
    ]
    .join("\n");

    let scope = format!("{date_stamp}/{region}/s3/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );

    let date_key = hmac(
        format!("AWS4{}", credentials.secret_key).as_bytes(),
        &date_stamp,
    )?;
    let region_key = hmac(&date_key, region)?;
    let service_key = hmac(&region_key, "s3")?;
    let signing_key = hmac(&service_key, "aws4_request")?;
    let signature = hex_lower(&hmac(&signing_key, &string_to_sign)?);

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        credentials.access_key, scope, signed_headers, signature
    );

    let mut request = client
        .get(url)
        .header("Host", host)
        .header("x-amz-date", amz_date)
        .header("x-amz-content-sha256", payload_hash)
        .header("Authorization", authorization)
        .header(ACCEPT_ENCODING, "identity");

    if let Some(token) = credentials.session_token.as_deref() {
        request = request.header("x-amz-security-token", token);
    }

    Ok(request)
}

fn node_text(node: roxmltree::Node<'_, '_>, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == name)
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[derive(Default)]
struct S3Page {
    entries: Vec<S3Entry>,
    truncated: bool,
    next_token: Option<String>,
}

fn parse_list_page(xml: &str, prefix: &str) -> Result<S3Page, String> {
    let document = Document::parse(xml)
        .map_err(|error| format!("S3 returned invalid ListObjects XML: {error}"))?;

    let mut page = S3Page::default();

    for node in document.descendants().filter(|node| node.is_element()) {
        match node.tag_name().name() {
            "CommonPrefixes" => {
                let Some(folder_prefix) = node_text(node, "Prefix") else {
                    continue;
                };
                let relative = folder_prefix
                    .strip_prefix(prefix)
                    .unwrap_or(&folder_prefix)
                    .trim_end_matches('/');
                let name = relative
                    .rsplit('/')
                    .next()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(relative)
                    .to_string();

                page.entries.push(S3Entry {
                    id: "prefix:".to_string() + &folder_prefix,
                    name,
                    key: folder_prefix,
                    size: None,
                    is_folder: true,
                    modified_at: None,
                    etag: None,
                });
            }
            "Contents" => {
                let Some(key) = node_text(node, "Key") else {
                    continue;
                };
                if key == prefix || key.ends_with('/') {
                    continue;
                }

                let relative = key.strip_prefix(prefix).unwrap_or(&key);
                let name = relative
                    .rsplit('/')
                    .next()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(relative)
                    .to_string();

                page.entries.push(S3Entry {
                    id: key.clone(),
                    name,
                    key,
                    size: node_text(node, "Size")
                        .and_then(|value| value.parse::<u64>().ok()),
                    is_folder: false,
                    modified_at: node_text(node, "LastModified"),
                    etag: node_text(node, "ETag")
                        .map(|value| value.trim_matches('"').to_string()),
                });
            }
            "IsTruncated" => {
                page.truncated = node.text().map(str::trim) == Some("true");
            }
            "NextContinuationToken" => {
                page.next_token = node.text().map(str::trim).map(ToString::to_string);
            }
            _ => {}
        }
    }

    Ok(page)
}

async fn list_objects(
    endpoint: &str,
    region: &str,
    bucket: &str,
    credentials: &S3Credentials,
    prefix: &str,
    recursive: bool,
    query_filter: Option<&str>,
) -> Result<S3ListResult, String> {
    let client = client()?;
    let base = object_url(endpoint, bucket, None)?;
    let mut continuation: Option<String> = None;
    let mut entries = Vec::new();
    let normalized_query = query_filter.map(|value| value.to_lowercase());
    let mut truncated = false;

    loop {
        let mut query = vec![
            ("list-type".to_string(), "2".to_string()),
            ("prefix".to_string(), prefix.to_string()),
            ("max-keys".to_string(), "1000".to_string()),
        ];

        if !recursive {
            query.push(("delimiter".to_string(), "/".to_string()));
        }

        if let Some(token) = continuation.as_ref() {
            query.push(("continuation-token".to_string(), token.clone()));
        }

        let response = signed_get(
            &client,
            base.clone(),
            region,
            credentials,
            query,
        )?
        .send()
        .await
        .map_err(|error| format!("S3 list request failed: {error}"))?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "S3 list request returned status {status}: {}",
                body.chars().take(240).collect::<String>()
            ));
        }

        let body = response
            .text()
            .await
            .map_err(|error| format!("Unable to read S3 list response: {error}"))?;
        let page = parse_list_page(&body, prefix)?;
        truncated = page.truncated;

        for entry in page.entries {
            if normalized_query
                .as_ref()
                .map(|query| entry.name.to_lowercase().contains(query))
                .unwrap_or(true)
            {
                entries.push(entry);
            }

            if entries.len() >= MAX_LIST_OBJECTS {
                truncated = true;
                break;
            }
        }

        if entries.len() >= MAX_LIST_OBJECTS || !page.truncated {
            break;
        }

        let Some(next) = page.next_token else {
            break;
        };
        continuation = Some(next);
    }

    if !recursive {
        entries.sort_by(|left, right| {
            right
                .is_folder
                .cmp(&left.is_folder)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
    }

    Ok(S3ListResult {
        bucket: bucket.to_string(),
        prefix: prefix.to_string(),
        entries,
        truncated,
    })
}

#[tauri::command]
pub async fn resource_s3_list(
    endpoint: String,
    region: String,
    bucket: String,
    access_key: String,
    secret_key: String,
    session_token: Option<String>,
    prefix: Option<String>,
) -> Result<S3ListResult, String> {
    let credentials = credentials(&access_key, &secret_key, session_token)?;
    list_objects(
        &endpoint,
        &region,
        &bucket,
        &credentials,
        prefix.as_deref().unwrap_or(""),
        false,
        None,
    )
    .await
}

#[tauri::command]
pub async fn resource_s3_search(
    endpoint: String,
    region: String,
    bucket: String,
    access_key: String,
    secret_key: String,
    session_token: Option<String>,
    prefix: Option<String>,
    query: String,
) -> Result<S3ListResult, String> {
    let credentials = credentials(&access_key, &secret_key, session_token)?;
    list_objects(
        &endpoint,
        &region,
        &bucket,
        &credentials,
        prefix.as_deref().unwrap_or(""),
        true,
        Some(query.trim()),
    )
    .await
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

async fn job_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-s3")
        .join(safe_job_component(job_id));

    fs::create_dir_all(&root)
        .await
        .map_err(|error| format!("Unable to create S3 transfer directory: {error}"))?;

    Ok(root)
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

async fn run_download(
    app: AppHandle,
    manager: S3TransferManager,
    control: Arc<AtomicU8>,
    job_id: String,
    endpoint: String,
    region: String,
    bucket: String,
    credentials: S3Credentials,
    key: String,
    file_name: String,
) -> Result<(), String> {
    let client = client()?;
    let object_url = object_url(&endpoint, &bucket, Some(&key))?;
    let dir = job_dir(&app, &job_id).await?;
    let name = safe_name(&file_name);
    let part_path = dir.join(format!("{name}.part"));
    let existing = fs::metadata(&part_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let mut request = signed_get(
        &client,
        object_url.clone(),
        &region,
        &credentials,
        vec![],
    )?;

    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("S3 download failed: {error}"))?;

    if !response.status().is_success()
        && response.status() != StatusCode::PARTIAL_CONTENT
    {
        return Err(format!(
            "S3 download returned status {}.",
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
    let total = response_length.map(|value| {
        if resumed {
            value.saturating_add(existing)
        } else {
            value
        }
    });

    if total.unwrap_or(0) > MAX_DOWNLOAD_BYTES {
        return Err("S3 object exceeds the 2 GiB transfer limit.".to_string());
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
        .map_err(|error| format!("Unable to open S3 transfer file: {error}"))?;

    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        match control.load(Ordering::Relaxed) {
            CONTROL_PAUSE => {
                file.flush()
                    .await
                    .map_err(|error| format!("Unable to flush paused S3 transfer: {error}"))?;
                let mut event = transfer_event(&job_id, "paused", total, completed);
                event.file_name = Some(name.clone());
                event.final_url = Some(format!("s3://{bucket}/{key}"));
                emit_event(&app, event);
                manager.remove(&job_id).await;
                return Ok(());
            }
            CONTROL_CANCEL => {
                drop(file);
                let _ = fs::remove_dir_all(&dir).await;
                let mut event = transfer_event(&job_id, "canceled", total, completed);
                event.file_name = Some(name.clone());
                event.final_url = Some(format!("s3://{bucket}/{key}"));
                emit_event(&app, event);
                manager.remove(&job_id).await;
                return Ok(());
            }
            _ => {}
        }

        let chunk = chunk
            .map_err(|error| format!("Unable to read S3 object: {error}"))?;
        completed = completed.saturating_add(chunk.len() as u64);

        if completed > MAX_DOWNLOAD_BYTES {
            let _ = fs::remove_dir_all(&dir).await;
            return Err("S3 transfer exceeded the 2 GiB limit.".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Unable to write S3 transfer: {error}"))?;

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
            event.final_url = Some(format!("s3://{bucket}/{key}"));
            emit_event(&app, event);
            last_emit = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|error| format!("Unable to finish S3 transfer: {error}"))?;
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
            return Err(format!("Unable to validate S3 download: {error}"));
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
        .map_err(|error| format!("Unable to finalize S3 transfer: {error}"))?;

    let mut event = transfer_event(&job_id, "downloaded", total, completed);
    event.progress = 1.0;
    event.temp_path = Some(final_path.to_string_lossy().to_string());
    event.file_name = Some(final_name);
    event.content_type = content_type;
    event.final_url = Some(format!("s3://{bucket}/{key}"));
    event.detected_format = Some(detected_format);
    emit_event(&app, event);

    manager.remove(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn resource_s3_start_download(
    app: AppHandle,
    manager: State<'_, S3TransferManager>,
    job_id: String,
    endpoint: String,
    region: String,
    bucket: String,
    access_key: String,
    secret_key: String,
    session_token: Option<String>,
    key: String,
    file_name: String,
) -> Result<bool, String> {
    let credentials = credentials(&access_key, &secret_key, session_token)?;
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
            endpoint,
            region,
            bucket,
            credentials,
            key,
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
pub async fn resource_s3_pause(
    manager: State<'_, S3TransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_PAUSE).await)
}

#[tauri::command]
pub async fn resource_s3_cancel(
    manager: State<'_, S3TransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_CANCEL).await)
}

#[tauri::command]
pub async fn resource_s3_cleanup(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-s3")
        .join(safe_job_component(&job_id));

    if !root.exists() {
        return Ok(false);
    }

    fs::remove_dir_all(&root)
        .await
        .map_err(|error| format!("Unable to clean S3 transfer files: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aws_encoding_preserves_only_rfc3986_unreserved_bytes() {
        assert_eq!(aws_encode("folder/My Book.epub", true), "folder/My%20Book.epub");
        assert_eq!(aws_encode("a+b", false), "a%2Bb");
    }

    #[test]
    fn canonical_query_is_sorted_and_encoded() {
        let query = canonical_query(&[
            ("prefix".to_string(), "My Books/".to_string()),
            ("list-type".to_string(), "2".to_string()),
        ]);

        assert_eq!(
            query,
            "list-type=2&prefix=My%20Books%2F"
        );
    }

    #[test]
    fn parses_list_objects_v2() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <CommonPrefixes><Prefix>books/history/</Prefix></CommonPrefixes>
  <Contents>
    <Key>books/book.azw3</Key>
    <LastModified>2026-10-04T12:00:00.000Z</LastModified>
    <ETag>"abc"</ETag>
    <Size>1234</Size>
  </Contents>
</ListBucketResult>"#;

        let page = parse_list_page(xml, "books/").unwrap();
        assert_eq!(page.entries.len(), 2);
        assert!(page.entries.iter().any(|entry| entry.is_folder));
        assert!(page.entries.iter().any(|entry| entry.name == "book.azw3"));
    }
}

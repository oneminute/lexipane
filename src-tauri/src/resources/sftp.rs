use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use serde::Serialize;
use ssh2::{FileStat, Session, Sftp};
use std::{
    collections::{HashMap, VecDeque},
    fs::{self as stdfs, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

const EVENT_NAME: &str = "resource-transfer-event";
const CONTROL_RUNNING: u8 = 0;
const CONTROL_PAUSE: u8 = 1;
const CONTROL_CANCEL: u8 = 2;
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_SEARCH_FOLDERS: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
    pub is_folder: bool,
    pub modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListResult {
    pub path: String,
    pub entries: Vec<SftpEntry>,
    pub truncated: bool,
}

#[derive(Clone, Default)]
pub struct SftpTransferManager {
    controls: Arc<Mutex<HashMap<String, Arc<AtomicU8>>>>,
}

impl SftpTransferManager {
    async fn register(&self, job_id: &str) -> Result<Arc<AtomicU8>, String> {
        let mut controls = self.controls.lock().await;
        if controls.contains_key(job_id) {
            return Err("This SFTP transfer is already running.".to_string());
        }

        let control = Arc::new(AtomicU8::new(CONTROL_RUNNING));
        controls.insert(job_id.to_string(), control.clone());
        Ok(control)
    }

    async fn signal(&self, job_id: &str, value: u8) -> bool {
        let controls = self.controls.lock().await;
        let Some(control) = controls.get(job_id) else {
            return false;
        };

        control.store(value, Ordering::Relaxed);
        true
    }

    async fn remove(&self, job_id: &str) {
        self.controls.lock().await.remove(job_id);
    }
}

#[derive(Clone)]
struct SftpCredentials {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
}

fn credentials(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
) -> Result<SftpCredentials, String> {
    let host = host.trim().to_string();
    let username = username.trim().to_string();

    if host.is_empty() {
        return Err("SFTP host is required.".to_string());
    }
    if username.is_empty() {
        return Err("SFTP username is required.".to_string());
    }
    if port == 0 {
        return Err("SFTP port must be greater than zero.".to_string());
    }

    let password = password.filter(|value| !value.is_empty());
    let private_key_path = private_key_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if password.is_none() && private_key_path.is_none() {
        return Err(
            "Provide either an SFTP password or a private-key path.".to_string(),
        );
    }

    Ok(SftpCredentials {
        host,
        port,
        username,
        password,
        private_key_path,
        private_key_passphrase: private_key_passphrase
            .filter(|value| !value.is_empty()),
    })
}

fn connect(credentials: &SftpCredentials) -> Result<(Session, Sftp), String> {
    let address = format!("{}:{}", credentials.host, credentials.port);
    let tcp = TcpStream::connect(&address)
        .map_err(|error| format!("Unable to connect to SFTP server {address}: {error}"))?;
    let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

    let mut session = Session::new()
        .map_err(|error| format!("Unable to create SSH session: {error}"))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| format!("SSH handshake failed: {error}"))?;

    if let Some(key_path) = credentials.private_key_path.as_deref() {
        session
            .userauth_pubkey_file(
                &credentials.username,
                None,
                Path::new(key_path),
                credentials.private_key_passphrase.as_deref(),
            )
            .map_err(|error| format!("SFTP private-key authentication failed: {error}"))?;
    } else if let Some(password) = credentials.password.as_deref() {
        session
            .userauth_password(&credentials.username, password)
            .map_err(|error| format!("SFTP password authentication failed: {error}"))?;
    }

    if !session.authenticated() {
        return Err("SFTP authentication did not complete.".to_string());
    }

    let sftp = session
        .sftp()
        .map_err(|error| format!("Unable to open SFTP subsystem: {error}"))?;

    Ok((session, sftp))
}

fn normalize_remote_path(value: Option<&str>) -> String {
    let value = value.unwrap_or("/").trim();
    if value.is_empty() {
        return "/".to_string();
    }

    let mut normalized = value.replace('\\', "/");
    if !normalized.starts_with('/') {
        normalized.insert(0, '/');
    }

    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }

    if normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }

    normalized
}

fn join_remote_path(parent: &str, name: &str) -> String {
    let parent = normalize_remote_path(Some(parent));
    if parent == "/" {
        format!("/{}", name.trim_start_matches('/'))
    } else {
        format!(
            "{}/{}",
            parent.trim_end_matches('/'),
            name.trim_start_matches('/')
        )
    }
}

fn stat_is_dir(stat: &FileStat) -> bool {
    stat.perm
        .map(|perm| perm & 0o170000 == 0o040000)
        .unwrap_or(false)
}

fn entry_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("resource")
        .to_string()
}

fn list_directory(
    sftp: &Sftp,
    remote_path: &str,
) -> Result<Vec<SftpEntry>, String> {
    let normalized = normalize_remote_path(Some(remote_path));
    let rows = sftp
        .readdir(Path::new(&normalized))
        .map_err(|error| format!("Unable to list SFTP directory {normalized}: {error}"))?;

    let mut entries = Vec::new();

    for (path, stat) in rows {
        let name = entry_name(&path);
        if name == "." || name == ".." {
            continue;
        }

        let path_string = path
            .to_str()
            .map(|value| normalize_remote_path(Some(value)))
            .unwrap_or_else(|| join_remote_path(&normalized, &name));

        entries.push(SftpEntry {
            id: path_string.clone(),
            name,
            path: path_string,
            size: stat.size,
            is_folder: stat_is_dir(&stat),
            modified_at: stat.mtime,
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
pub async fn resource_sftp_list(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    path: Option<String>,
) -> Result<SftpListResult, String> {
    let credentials = credentials(
        host,
        port,
        username,
        password,
        private_key_path,
        private_key_passphrase,
    )?;
    let remote_path = normalize_remote_path(path.as_deref());

    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&credentials)?;
        let entries = list_directory(&sftp, &remote_path)?;

        Ok(SftpListResult {
            path: remote_path,
            entries,
            truncated: false,
        })
    })
    .await
    .map_err(|error| format!("SFTP browse task failed: {error}"))?
}

#[tauri::command]
pub async fn resource_sftp_search(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    path: Option<String>,
    query: String,
) -> Result<SftpListResult, String> {
    let credentials = credentials(
        host,
        port,
        username,
        password,
        private_key_path,
        private_key_passphrase,
    )?;
    let root = normalize_remote_path(path.as_deref());
    let query = query.trim().to_lowercase();

    tauri::async_runtime::spawn_blocking(move || {
        let (_session, sftp) = connect(&credentials)?;
        let mut queue = VecDeque::from([root.clone()]);
        let mut seen = std::collections::HashSet::new();
        let mut matches = Vec::new();
        let mut truncated = false;

        while let Some(folder) = queue.pop_front() {
            if seen.len() >= MAX_SEARCH_FOLDERS {
                truncated = true;
                break;
            }
            if !seen.insert(folder.clone()) {
                continue;
            }

            let entries = match list_directory(&sftp, &folder) {
                Ok(entries) => entries,
                Err(_) => continue,
            };

            for entry in entries {
                if entry.is_folder {
                    queue.push_back(entry.path.clone());
                } else if query.is_empty()
                    || entry.name.to_lowercase().contains(&query)
                {
                    matches.push(entry);
                }
            }
        }

        Ok(SftpListResult {
            path: root,
            entries: matches,
            truncated,
        })
    })
    .await
    .map_err(|error| format!("SFTP search task failed: {error}"))?
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
            if ch.is_control()
                || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
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

fn job_dir(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-sftp")
        .join(safe_job_component(job_id));

    stdfs::create_dir_all(&root)
        .map_err(|error| format!("Unable to create SFTP transfer directory: {error}"))?;
    Ok(root)
}

fn run_download_blocking(
    app: AppHandle,
    control: Arc<AtomicU8>,
    job_id: String,
    credentials: SftpCredentials,
    remote_path: String,
    file_name: String,
) -> Result<(), String> {
    let (_session, sftp) = connect(&credentials)?;
    let remote_path = normalize_remote_path(Some(&remote_path));
    let stat = sftp
        .stat(Path::new(&remote_path))
        .map_err(|error| format!("Unable to stat SFTP file: {error}"))?;
    let total = stat.size;

    if total.unwrap_or(0) > MAX_DOWNLOAD_BYTES {
        return Err("SFTP file exceeds the 2 GiB transfer limit.".to_string());
    }

    let dir = job_dir(&app, &job_id)?;
    let name = safe_name(&file_name);
    let part_path = dir.join(format!("{name}.part"));
    let existing = stdfs::metadata(&part_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if total.map(|value| existing > value).unwrap_or(false) {
        let _ = stdfs::remove_file(&part_path);
    }

    let existing = stdfs::metadata(&part_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    if let Some(total) = total {
        if existing == total && total > 0 {
            let detected_format = validate_downloaded_book(&part_path)?;
            let final_name = if Path::new(&name)
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(&detected_format))
                .unwrap_or(false)
            {
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
                let _ = stdfs::remove_file(&final_path);
            }
            stdfs::rename(&part_path, &final_path)
                .map_err(|error| format!("Unable to finalize recovered SFTP file: {error}"))?;

            let mut event = transfer_event(&job_id, "downloaded", Some(total), total);
            event.progress = 1.0;
            event.temp_path = Some(final_path.to_string_lossy().to_string());
            event.file_name = Some(final_name);
            event.final_url = Some(format!(
                "sftp://{}:{}{}",
                credentials.host, credentials.port, remote_path
            ));
            event.detected_format = Some(detected_format);
            emit_event(&app, event);
            return Ok(());
        }
    }

    let mut remote = sftp
        .open(Path::new(&remote_path))
        .map_err(|error| format!("Unable to open SFTP file: {error}"))?;

    if existing > 0 {
        remote
            .seek(SeekFrom::Start(existing))
            .map_err(|error| format!("Unable to seek SFTP file for resume: {error}"))?;
    }

    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if existing > 0 {
        options.append(true);
    } else {
        options.truncate(true);
    }

    let mut local = options
        .open(&part_path)
        .map_err(|error| format!("Unable to open SFTP transfer file: {error}"))?;

    let mut completed = existing;
    let mut buffer = vec![0_u8; 128 * 1024];
    let started = Instant::now();
    let mut last_emit = Instant::now();

    let mut started_event = transfer_event(&job_id, "running", total, completed);
    started_event.file_name = Some(name.clone());
    started_event.final_url = Some(format!(
        "sftp://{}:{}{}",
        credentials.host, credentials.port, remote_path
    ));
    emit_event(&app, started_event);

    loop {
        match control.load(Ordering::Relaxed) {
            CONTROL_PAUSE => {
                local
                    .flush()
                    .map_err(|error| format!("Unable to flush paused SFTP transfer: {error}"))?;
                let mut event = transfer_event(&job_id, "paused", total, completed);
                event.file_name = Some(name.clone());
                event.final_url = Some(format!(
                    "sftp://{}:{}{}",
                    credentials.host, credentials.port, remote_path
                ));
                emit_event(&app, event);
                return Ok(());
            }
            CONTROL_CANCEL => {
                drop(local);
                let _ = stdfs::remove_dir_all(&dir);
                let mut event = transfer_event(&job_id, "canceled", total, completed);
                event.file_name = Some(name.clone());
                emit_event(&app, event);
                return Ok(());
            }
            _ => {}
        }

        let read = remote
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read SFTP file: {error}"))?;
        if read == 0 {
            break;
        }

        completed = completed.saturating_add(read as u64);
        if completed > MAX_DOWNLOAD_BYTES {
            let _ = stdfs::remove_dir_all(&dir);
            return Err("SFTP transfer exceeded the 2 GiB limit.".to_string());
        }

        local
            .write_all(&buffer[..read])
            .map_err(|error| format!("Unable to write SFTP transfer: {error}"))?;

        if last_emit.elapsed().as_millis() >= 250 {
            let mut event = transfer_event(&job_id, "running", total, completed);
            let seconds = started.elapsed().as_secs_f64();
            if seconds > 0.0 {
                event.download_rate =
                    Some(completed.saturating_sub(existing) as f64 / seconds);
            }
            event.file_name = Some(name.clone());
            event.final_url = Some(format!(
                "sftp://{}:{}{}",
                credentials.host, credentials.port, remote_path
            ));
            emit_event(&app, event);
            last_emit = Instant::now();
        }
    }

    local
        .flush()
        .map_err(|error| format!("Unable to finish SFTP transfer: {error}"))?;
    drop(local);

    let detected_format = match validate_downloaded_book(&part_path) {
        Ok(format) => format,
        Err(error) => {
            let _ = stdfs::remove_dir_all(&dir);
            return Err(error);
        }
    };

    let final_name = if Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(&detected_format))
        .unwrap_or(false)
    {
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
        let _ = stdfs::remove_file(&final_path);
    }
    stdfs::rename(&part_path, &final_path)
        .map_err(|error| format!("Unable to finalize SFTP file: {error}"))?;

    let mut event = transfer_event(&job_id, "downloaded", total, completed);
    event.progress = 1.0;
    event.temp_path = Some(final_path.to_string_lossy().to_string());
    event.file_name = Some(final_name);
    event.final_url = Some(format!(
        "sftp://{}:{}{}",
        credentials.host, credentials.port, remote_path
    ));
    event.detected_format = Some(detected_format);
    emit_event(&app, event);

    Ok(())
}

#[tauri::command]
pub async fn resource_sftp_start_download(
    app: AppHandle,
    manager: State<'_, SftpTransferManager>,
    limiter: State<'_, crate::resources::ResourceTransferLimiter>,
    job_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    remote_path: String,
    file_name: String,
) -> Result<bool, String> {
    let credentials = credentials(
        host,
        port,
        username,
        password,
        private_key_path,
        private_key_passphrase,
    )?;
    let manager = manager.inner().clone();
    let limiter = limiter.inner().clone();
    let control = manager.register(&job_id).await?;
    let spawned_manager = manager.clone();
    let spawned_job = job_id.clone();
    let spawned_app = app.clone();

    tauri::async_runtime::spawn(async move {
        let _permit = limiter.acquire().await;
        let blocking_app = spawned_app.clone();
        let blocking_control = control.clone();
        let blocking_job = spawned_job.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            run_download_blocking(
                blocking_app,
                blocking_control,
                blocking_job,
                credentials,
                remote_path,
                file_name,
            )
        })
        .await;

        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let mut event = transfer_event(&spawned_job, "failed", None, 0);
                event.error = Some(error);
                emit_event(&spawned_app, event);
            }
            Err(error) => {
                let mut event = transfer_event(&spawned_job, "failed", None, 0);
                event.error = Some(format!("SFTP download task failed: {error}"));
                emit_event(&spawned_app, event);
            }
        }

        spawned_manager.remove(&spawned_job).await;
    });

    Ok(true)
}

#[tauri::command]
pub async fn resource_sftp_pause(
    manager: State<'_, SftpTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_PAUSE).await)
}

#[tauri::command]
pub async fn resource_sftp_cancel(
    manager: State<'_, SftpTransferManager>,
    job_id: String,
) -> Result<bool, String> {
    Ok(manager.signal(&job_id, CONTROL_CANCEL).await)
}

#[tauri::command]
pub async fn resource_sftp_cleanup(
    app: AppHandle,
    job_id: String,
) -> Result<bool, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?
        .join("resource-sftp")
        .join(safe_job_component(&job_id));

    if !root.exists() {
        return Ok(false);
    }

    stdfs::remove_dir_all(&root)
        .map_err(|error| format!("Unable to clean SFTP transfer files: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_remote_paths() {
        assert_eq!(normalize_remote_path(Some("books/history/")), "/books/history");
        assert_eq!(normalize_remote_path(Some("/")), "/");
        assert_eq!(join_remote_path("/books", "history"), "/books/history");
    }

    #[test]
    fn rejects_missing_sftp_credentials() {
        assert!(credentials(
            "example.test".to_string(),
            22,
            "reader".to_string(),
            None,
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn recognizes_directory_mode_bits() {
        let directory = FileStat {
            size: None,
            uid: None,
            gid: None,
            perm: Some(0o040755),
            atime: None,
            mtime: None,
        };
        assert!(stat_is_dir(&directory));
    }
}

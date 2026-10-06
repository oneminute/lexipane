use crate::resources::http::{validate_downloaded_book, ResourceTransferEvent};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs as stdfs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::AsyncWriteExt,
    process::Command,
    sync::Mutex,
    time::sleep,
};

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
pub struct Ed2kEnvironment {
    pub installed: bool,
    pub executable: Option<String>,
    pub core_executable: Option<String>,
    pub config_path: Option<String>,
    pub config_exists: bool,
    pub incoming_dir: Option<String>,
    pub host: String,
    pub port: u16,
    pub external_connections_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ed2kAutoConfigureResult {
    pub environment: Ed2kEnvironment,
    pub available: bool,
    pub started: bool,
    pub restart_required: bool,
    pub status: String,
    pub warnings: Vec<String>,
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


fn platform_executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn default_config_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|path| path.join("aMule"));
    }

    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| {
                path.join("Library")
                    .join("Application Support")
                    .join("aMule")
            });
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .map(|path| path.join(".aMule"));
    }

    #[allow(unreachable_code)]
    None
}

fn default_incoming_dir(config_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(home) = env::var_os("USERPROFILE") {
            return PathBuf::from(home)
                .join("Documents")
                .join("aMule Downloads");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Documents")
                .join("aMule Downloads");
        }
    }

    config_dir.join("Incoming")
}

fn executable_candidates(name: &str) -> Vec<PathBuf> {
    let executable_name = platform_executable_name(name);
    let mut candidates = Vec::new();

    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.push(directory.join(&executable_name));
        }
    }

    #[cfg(windows)]
    {
        if let Some(program_files) = env::var_os("ProgramFiles") {
            let root = PathBuf::from(program_files).join("aMule");
            candidates.push(root.join("bin").join(&executable_name));
            candidates.push(root.join(&executable_name));
        }

        if let Some(program_files) = env::var_os("ProgramFiles(x86)") {
            let root = PathBuf::from(program_files).join("aMule");
            candidates.push(root.join("bin").join(&executable_name));
            candidates.push(root.join(&executable_name));
        }

        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let root = PathBuf::from(local).join("Programs").join("aMule");
            candidates.push(root.join("bin").join(&executable_name));
            candidates.push(root.join(&executable_name));
        }
    }

    candidates
}

fn find_executable(name: &str) -> Option<PathBuf> {
    executable_candidates(name)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn sibling_executable(executable_path: &Path, name: &str) -> Option<PathBuf> {
    let candidate = executable_path.with_file_name(platform_executable_name(name));
    candidate.is_file().then_some(candidate)
}

fn ini_value(content: &str, section: &str, key: &str) -> Option<String> {
    let target_section = format!("[{section}]").to_ascii_lowercase();
    let target_key = key.to_ascii_lowercase();
    let mut in_section = false;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            in_section = line.to_ascii_lowercase() == target_section;
            continue;
        }

        if !in_section || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        let Some((found_key, value)) = line.split_once('=') else {
            continue;
        };

        if found_key.trim().to_ascii_lowercase() == target_key {
            return Some(value.trim().to_string());
        }
    }

    None
}

fn upsert_ini_value(content: &str, section: &str, key: &str, value: &str) -> String {
    let mut lines = content.lines().map(ToString::to_string).collect::<Vec<_>>();
    let target_section = format!("[{section}]").to_ascii_lowercase();
    let target_key = key.to_ascii_lowercase();

    let section_start = lines.iter().position(|line| {
        line.trim().to_ascii_lowercase() == target_section
    });

    match section_start {
        Some(start) => {
            let section_end = lines
                .iter()
                .enumerate()
                .skip(start + 1)
                .find(|(_, line)| {
                    let trimmed = line.trim();
                    trimmed.starts_with('[') && trimmed.ends_with(']')
                })
                .map(|(index, _)| index)
                .unwrap_or(lines.len());

            if let Some(index) = (start + 1..section_end).find(|index| {
                lines[*index]
                    .split_once('=')
                    .map(|(found_key, _)| {
                        found_key.trim().to_ascii_lowercase() == target_key
                    })
                    .unwrap_or(false)
            }) {
                lines[index] = format!("{key}={value}");
            } else {
                lines.insert(section_end, format!("{key}={value}"));
            }
        }
        None => {
            if !lines.is_empty() && !lines.last().is_some_and(|line| line.is_empty()) {
                lines.push(String::new());
            }
            lines.push(format!("[{section}]"));
            lines.push(format!("{key}={value}"));
        }
    }

    let mut updated = lines.join("\n");
    updated.push('\n');
    updated
}

fn detect_environment_internal() -> Ed2kEnvironment {
    let executable = find_executable("amulecmd");
    let core_executable = executable
        .as_deref()
        .and_then(|path| sibling_executable(path, "amuled"))
        .or_else(|| find_executable("amuled"));
    let config_path = default_config_dir().map(|dir| dir.join("amule.conf"));
    let config_exists = config_path
        .as_deref()
        .map(Path::is_file)
        .unwrap_or(false);
    let config_text = config_path
        .as_deref()
        .and_then(|path| stdfs::read_to_string(path).ok())
        .unwrap_or_default();

    let config_dir = config_path
        .as_deref()
        .and_then(Path::parent)
        .map(PathBuf::from);
    let incoming_dir = ini_value(&config_text, "eMule", "IncomingDir")
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            config_dir
                .as_deref()
                .map(default_incoming_dir)
        });

    let port = ini_value(&config_text, "ExternalConnect", "ECPort")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(4712);
    let external_connections_enabled =
        ini_value(
            &config_text,
            "ExternalConnect",
            "AcceptExternalConnections",
        )
        .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);

    Ed2kEnvironment {
        installed: executable.is_some(),
        executable: executable.as_deref().map(path_string),
        core_executable: core_executable.as_deref().map(path_string),
        config_path: config_path.as_deref().map(path_string),
        config_exists,
        incoming_dir: incoming_dir.as_deref().map(path_string),
        host: "127.0.0.1".to_string(),
        port,
        external_connections_enabled,
    }
}

async fn ensure_bootstrap_file(
    url: &str,
    destination: &Path,
    warnings: &mut Vec<String>,
) {
    if stdfs::metadata(destination)
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
    {
        return;
    }

    let response = match reqwest::get(url).await {
        Ok(response) => response,
        Err(error) => {
            warnings.push(format!(
                "Unable to download {}: {error}",
                destination
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("ED2K bootstrap file")
            ));
            return;
        }
    };

    if !response.status().is_success() {
        warnings.push(format!(
            "Bootstrap URL returned HTTP {}: {url}",
            response.status()
        ));
        return;
    }

    match response.bytes().await {
        Ok(bytes) => {
            if let Err(error) = tokio::fs::write(destination, bytes).await {
                warnings.push(format!(
                    "Unable to write {}: {error}",
                    path_string(destination)
                ));
            }
        }
        Err(error) => warnings.push(format!(
            "Unable to read ED2K bootstrap download: {error}"
        )),
    }
}

async fn run_amulecmd_session(
    config: &Ed2kConnectionConfig,
    commands: &[String],
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
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("LC_ALL", "C")
        .env("LANG", "C");

    let mut child = process.spawn().map_err(|error| {
        format!("Unable to run {}: {error}", executable(config))
    })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Unable to open amulecmd input.".to_string())?;

    for command in commands {
        stdin
            .write_all(command.as_bytes())
            .await
            .map_err(|error| format!("Unable to send amulecmd command: {error}"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("Unable to send amulecmd command: {error}"))?;
    }
    stdin
        .write_all(b"Quit\n")
        .await
        .map_err(|error| format!("Unable to close amulecmd session: {error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("Unable to wait for amulecmd: {error}"))?;

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

#[tauri::command]
pub fn resource_ed2k_detect() -> Ed2kEnvironment {
    detect_environment_internal()
}

#[tauri::command]
pub async fn resource_ed2k_auto_configure(
    password: String,
) -> Result<Ed2kAutoConfigureResult, String> {
    if password.trim().len() < 12 {
        return Err(
            "The generated ED2K control password is unexpectedly short."
                .to_string(),
        );
    }

    let before = detect_environment_internal();
    if !before.installed {
        return Ok(Ed2kAutoConfigureResult {
            environment: before,
            available: false,
            started: false,
            restart_required: false,
            status: "aMule 3.x / amulecmd was not found.".to_string(),
            warnings: Vec::new(),
        });
    }

    let config_path = default_config_dir()
        .ok_or_else(|| "Unable to resolve the aMule configuration directory.".to_string())?
        .join("amule.conf");
    let config_dir = config_path
        .parent()
        .ok_or_else(|| "Unable to resolve the aMule configuration directory.".to_string())?
        .to_path_buf();

    stdfs::create_dir_all(&config_dir)
        .map_err(|error| format!("Unable to create aMule config directory: {error}"))?;

    let incoming_dir = before
        .incoming_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_incoming_dir(&config_dir));
    stdfs::create_dir_all(&incoming_dir)
        .map_err(|error| format!("Unable to create aMule Incoming directory: {error}"))?;

    let original = stdfs::read_to_string(&config_path).unwrap_or_default();
    if config_path.is_file() {
        let backup = config_dir.join("amule.conf.lexipane.bak");
        if !backup.exists() {
            let _ = stdfs::copy(&config_path, backup);
        }
    }

    let password_hash = format!("{:x}", Md5::digest(password.as_bytes()));
    let mut updated = original;
    for (section, key, value) in [
        ("eMule", "ConnectToED2K", "1".to_string()),
        ("eMule", "ConnectToKad", "1".to_string()),
        ("eMule", "Autoconnect", "1".to_string()),
        ("eMule", "Reconnect", "1".to_string()),
        (
            "eMule",
            "Ed2kServersUrl",
            "https://upd.emule-security.org/server.met".to_string(),
        ),
        (
            "eMule",
            "KadNodesUrl",
            "https://upd.emule-security.org/nodes.dat".to_string(),
        ),
        ("eMule", "IncomingDir", path_string(&incoming_dir)),
        (
            "ExternalConnect",
            "AcceptExternalConnections",
            "1".to_string(),
        ),
        (
            "ExternalConnect",
            "ECAddress",
            "127.0.0.1".to_string(),
        ),
        ("ExternalConnect", "ECPort", "4712".to_string()),
        (
            "ExternalConnect",
            "ECPassword",
            password_hash.clone(),
        ),
    ] {
        updated = upsert_ini_value(&updated, section, key, &value);
    }

    stdfs::write(&config_path, updated)
        .map_err(|error| format!("Unable to update aMule configuration: {error}"))?;

    let mut warnings = Vec::new();
    ensure_bootstrap_file(
        "https://upd.emule-security.org/server.met",
        &config_dir.join("server.met"),
        &mut warnings,
    )
    .await;
    ensure_bootstrap_file(
        "https://upd.emule-security.org/nodes.dat",
        &config_dir.join("nodes.dat"),
        &mut warnings,
    )
    .await;

    let environment = detect_environment_internal();
    let config = Ed2kConnectionConfig {
        executable: environment.executable.clone(),
        host: Some("127.0.0.1".to_string()),
        port: Some(4712),
        password: Some(password),
        incoming_dir: Some(path_string(&incoming_dir)),
    };

    let mut started = false;
    let mut status_result = run_amulecmd(&config, "Status").await;

    if status_result.is_err() {
        if let Some(core) = environment.core_executable.as_deref() {
            let mut process = Command::new(core);
            process
                .arg("--full-daemon")
                .arg("-c")
                .arg(&config_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());

            match process.spawn() {
                Ok(_) => {
                    started = true;
                    for _ in 0..12 {
                        sleep(Duration::from_millis(500)).await;
                        status_result = run_amulecmd(&config, "Status").await;
                        if status_result.is_ok() {
                            break;
                        }
                    }
                }
                Err(error) => warnings.push(format!(
                    "aMule is configured, but amuled could not be started automatically: {error}"
                )),
            }
        }
    }

    match status_result {
        Ok(status) => {
            let _ = run_amulecmd(&config, "Connect").await;
            Ok(Ed2kAutoConfigureResult {
                environment,
                available: true,
                started,
                restart_required: false,
                status,
                warnings,
            })
        }
        Err(error) => Ok(Ed2kAutoConfigureResult {
            environment,
            available: false,
            started,
            restart_required: true,
            status: format!(
                "aMule configuration was updated, but the running core is not accepting the new local External Connections settings yet: {error}"
            ),
            warnings,
        }),
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
    lower.ends_with(".pdf")
        || lower.ends_with(".epub")
        || lower.ends_with(".mobi")
        || lower.ends_with(".azw")
        || lower.ends_with(".azw3")
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

    // A local sidecar can be healthy while the ED2K/Kad networks are still
    // disconnected. Ask aMule to connect before starting the search.
    let _ = run_amulecmd(&config, "Connect").await;
    sleep(Duration::from_millis(750)).await;

    let command = format!("Search {search_type} {query}");
    run_amulecmd(&config, &command).await?;

    let mut output = String::new();
    let mut results = Vec::new();
    for attempt in 0..4 {
        sleep(Duration::from_millis(1250)).await;
        output = run_amulecmd(&config, "Results").await?;
        results = parse_search_results(&output);
        if !results.is_empty() && attempt >= 1 {
            break;
        }
    }

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

    // amulecmd keeps the numeric Result -> file mapping in the CLI
    // session. Re-list Results and Download in one session so the selected
    // index resolves reliably instead of invoking Download in a fresh client.
    run_amulecmd_session(
        &config,
        &[
            "Results".to_string(),
            format!("Download {result_index}"),
        ],
    )
    .await?;

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

    #[test]
    fn updates_amule_ini_without_overwriting_other_settings() {
        let original = "[eMule]\nNickname=reader\n\n[ExternalConnect]\nECPort=1234\n";
        let updated = upsert_ini_value(
            original,
            "ExternalConnect",
            "ECPort",
            "4712",
        );
        let updated = upsert_ini_value(
            &updated,
            "ExternalConnect",
            "ECAddress",
            "127.0.0.1",
        );

        assert!(updated.contains("Nickname=reader"));
        assert!(updated.contains("ECPort=4712"));
        assert!(updated.contains("ECAddress=127.0.0.1"));
    }

    #[test]
    fn recognizes_all_reader_ed2k_formats() {
        assert!(is_book_candidate("book.pdf"));
        assert!(is_book_candidate("book.epub"));
        assert!(is_book_candidate("book.mobi"));
        assert!(is_book_candidate("book.azw"));
        assert!(is_book_candidate("book.azw3"));
        assert!(!is_book_candidate("movie.mkv"));
    }
}

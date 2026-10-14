use crate::resources::ed2k::{
    attach_existing_ed2k_job, attach_started_ed2k_link,
    ed2k_job_is_attached, parse_ed2k_file_link, Ed2kConnectionConfig,
    Ed2kLinkMetadata, Ed2kManager, Ed2kStartResult,
};
use md5::{Digest, Md5};
use serde::Serialize;
use sha2::Sha256;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::{sleep, timeout, Duration},
};

const AMULE_RUNTIME_VERSION: &str = "3.1.0";
const EC_PORT: u16 = 4712;

#[derive(Debug, Clone)]
struct ManagedAmuleLayout {
    runtime_dir: PathBuf,
    daemon_path: PathBuf,
    command_path: PathBuf,
    config_dir: PathBuf,
    incoming_dir: PathBuf,
    temp_dir: PathBuf,
}

#[derive(Debug)]
struct ManagedAmuleProcess {
    child: Child,
    control_password: String,
    ready: bool,
    status_output: Option<String>,
}

#[derive(Clone, Default)]
pub struct ManagedAmuleRuntimeManager {
    process: Arc<Mutex<Option<ManagedAmuleProcess>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAmuleRuntimeStatus {
    pub version: String,
    pub available: bool,
    pub running: bool,
    pub ready: bool,
    pub pid: Option<u32>,
    pub runtime_dir: String,
    pub daemon_path: String,
    pub command_path: Option<String>,
    pub config_dir: String,
    pub incoming_dir: String,
    pub temp_dir: String,
    pub ec_port: u16,
    pub status_output: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAmuleEnqueueProbe {
    pub name: String,
    pub size: u64,
    pub hash: String,
    pub runtime_ready: bool,
    pub add_output: String,
    pub queue_verified: bool,
    pub queue_output: String,
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("LEXIPANE_AMULE_RUNTIME_DIR") {
        let candidate = PathBuf::from(value);
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }

    let resource_candidate = app
        .path()
        .resource_dir()
        .map_err(|error| {
            format!("Unable to resolve LexiPane resource directory: {error}")
        })?
        .join("runtime")
        .join("amule");
    if resource_candidate.is_dir() {
        return Ok(resource_candidate);
    }

    let development_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("runtime")
        .join("amule");
    Ok(development_candidate)
}

fn managed_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("ed2k").join("amule-runtime"))
        .map_err(|error| {
            format!("Unable to resolve LexiPane application data directory: {error}")
        })
}

fn layout(app: &AppHandle) -> Result<ManagedAmuleLayout, String> {
    let runtime_dir = runtime_dir(app)?;
    let data_root = managed_data_root(app)?;
    Ok(ManagedAmuleLayout {
        daemon_path: runtime_dir.join(executable_name("amuled")),
        command_path: runtime_dir.join(executable_name("amulecmd")),
        runtime_dir,
        config_dir: data_root.join("config"),
        incoming_dir: data_root.join("incoming"),
        temp_dir: data_root.join("temp"),
    })
}

fn status_from_layout(
    layout: &ManagedAmuleLayout,
    running: bool,
    ready: bool,
    pid: Option<u32>,
    status_output: Option<String>,
) -> ManagedAmuleRuntimeStatus {
    ManagedAmuleRuntimeStatus {
        version: AMULE_RUNTIME_VERSION.to_string(),
        available: layout.daemon_path.is_file() && layout.command_path.is_file(),
        running,
        ready,
        pid,
        runtime_dir: path_string(&layout.runtime_dir),
        daemon_path: path_string(&layout.daemon_path),
        command_path: layout
            .command_path
            .is_file()
            .then(|| path_string(&layout.command_path)),
        config_dir: path_string(&layout.config_dir),
        incoming_dir: path_string(&layout.incoming_dir),
        temp_dir: path_string(&layout.temp_dir),
        ec_port: EC_PORT,
        status_output,
    }
}

fn managed_connection_config(
    layout: &ManagedAmuleLayout,
    control_password: String,
) -> Ed2kConnectionConfig {
    Ed2kConnectionConfig {
        executable: Some(path_string(&layout.command_path)),
        host: Some("127.0.0.1".to_string()),
        port: Some(EC_PORT),
        password: Some(control_password),
        incoming_dir: Some(path_string(&layout.incoming_dir)),
    }
}

fn generate_control_password() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seed = format!("{now}:{}:{}", std::process::id(), env!("CARGO_PKG_VERSION"));
    let digest = <Sha256 as sha2::Digest>::digest(seed.as_bytes());
    digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn write_managed_config(
    layout: &ManagedAmuleLayout,
    plain_password: &str,
) -> Result<(), String> {
    for directory in [
        &layout.config_dir,
        &layout.incoming_dir,
        &layout.temp_dir,
    ] {
        fs::create_dir_all(directory).map_err(|error| {
            format!(
                "Unable to create managed aMule directory {}: {error}",
                path_string(directory)
            )
        })?;
    }

    let password_hash = format!("{:x}", Md5::digest(plain_password.as_bytes()));
    let content = format!(
        "[eMule]\nConnectToED2K=1\nConnectToKad=1\nAutoconnect=1\nReconnect=1\nIncomingDir={}\nTempDir={}\n\n[ExternalConnect]\nAcceptExternalConnections=1\nECAddress=127.0.0.1\nECPort={}\nECPassword={}\n",
        path_string(&layout.incoming_dir),
        path_string(&layout.temp_dir),
        EC_PORT,
        password_hash,
    );

    fs::write(layout.config_dir.join("amule.conf"), content)
        .map_err(|error| format!("Unable to write managed aMule configuration: {error}"))
}

fn normalized_ed2k_hash(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() != 32
        || !trimmed.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err("Managed ED2K recovery requires a valid 32-character file hash.".to_string());
    }
    Ok(trimmed.to_ascii_lowercase())
}

fn queue_contains_hash(output: &str, hash: &str) -> bool {
    let target = hash.trim().to_ascii_lowercase();
    output
        .split_whitespace()
        .any(|token| token.trim().eq_ignore_ascii_case(&target))
}

fn bounded_text(value: String) -> String {
    const LIMIT: usize = 4096;
    if value.len() <= LIMIT {
        return value;
    }

    let mut end = LIMIT;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… output truncated …", &value[..end])
}

async fn run_control_command(
    layout: &ManagedAmuleLayout,
    password: &str,
    command_text: &str,
) -> Result<String, String> {
    if !layout.command_path.is_file() {
        return Err(format!(
            "Bundled amulecmd was not found at {}.",
            path_string(&layout.command_path)
        ));
    }

    let mut command = Command::new(&layout.command_path);
    command
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(EC_PORT.to_string())
        .arg("-P")
        .arg(password)
        .arg("-c")
        .arg(command_text)
        .current_dir(&layout.runtime_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("LC_ALL", "C")
        .env("LANG", "C");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command
            .as_std_mut()
            .creation_flags(0x08000000);
    }

    let output = timeout(Duration::from_secs(3), command.output())
        .await
        .map_err(|_| {
            format!(
                "Timed out waiting for bundled amulecmd command: {command_text}"
            )
        })?
        .map_err(|error| {
            format!(
                "Unable to run bundled amulecmd command {command_text}: {error}"
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout.as_str(), stderr.as_str()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if !output.status.success() {
        return Err(if combined.is_empty() {
            format!(
                "Bundled amulecmd command {command_text} exited with status {}.",
                output.status
            )
        } else {
            bounded_text(combined)
        });
    }

    Ok(bounded_text(combined))
}

impl ManagedAmuleRuntimeManager {
    async fn status(
        &self,
        app: &AppHandle,
    ) -> Result<ManagedAmuleRuntimeStatus, String> {
        let layout = layout(app)?;
        let mut process = self.process.lock().await;
        let Some(managed) = process.as_mut() else {
            return Ok(status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            ));
        };

        match managed.child.try_wait() {
            Ok(None) => Ok(status_from_layout(
                &layout,
                true,
                managed.ready,
                managed.child.id(),
                managed.status_output.clone(),
            )),
            Ok(Some(_)) => {
                *process = None;
                Ok(status_from_layout(
                    &layout,
                    false,
                    false,
                    None,
                    None,
                ))
            }
            Err(error) => Err(format!(
                "Unable to inspect managed aMule process: {error}"
            )),
        }
    }

    async fn start(
        &self,
        app: &AppHandle,
    ) -> Result<ManagedAmuleRuntimeStatus, String> {
        let layout = layout(app)?;
        if !layout.daemon_path.is_file() || !layout.command_path.is_file() {
            return Ok(status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            ));
        }

        let mut process = self.process.lock().await;
        if let Some(managed) = process.as_mut() {
            match managed.child.try_wait() {
                Ok(None) => {
                    return Ok(status_from_layout(
                        &layout,
                        true,
                        managed.ready,
                        managed.child.id(),
                        managed.status_output.clone(),
                    ))
                }
                Ok(Some(_)) => {
                    *process = None;
                }
                Err(error) => {
                    return Err(format!(
                        "Unable to inspect managed aMule process: {error}"
                    ))
                }
            }
        }

        let control_password = generate_control_password();
        write_managed_config(&layout, &control_password)?;

        let mut command = Command::new(&layout.daemon_path);
        command
            .arg("-c")
            .arg(&layout.config_dir)
            .current_dir(&layout.runtime_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command
                .as_std_mut()
                .creation_flags(0x08000000);
        }

        let child = command.spawn().map_err(|error| {
            format!(
                "Unable to start bundled aMule runtime {}: {error}",
                path_string(&layout.daemon_path)
            )
        })?;

        let pid = child.id();
        *process = Some(ManagedAmuleProcess {
            child,
            control_password: control_password.clone(),
            ready: false,
            status_output: None,
        });
        drop(process);

        let mut last_error = None;
        for _ in 0..24 {
            sleep(Duration::from_millis(250)).await;

            {
                let mut process = self.process.lock().await;
                let Some(managed) = process.as_mut() else {
                    return Err(
                        "Managed aMule process disappeared during startup."
                            .to_string(),
                    );
                };
                match managed.child.try_wait() {
                    Ok(None) => {}
                    Ok(Some(status)) => {
                        *process = None;
                        return Err(format!(
                            "Bundled amuled exited during startup with status {status}."
                        ));
                    }
                    Err(error) => {
                        return Err(format!(
                            "Unable to inspect bundled amuled during startup: {error}"
                        ));
                    }
                }
            }

            match run_control_command(
                &layout,
                &control_password,
                "Status",
            )
            .await
            {
                Ok(output) => {
                    let mut process = self.process.lock().await;
                    let Some(managed) = process.as_mut() else {
                        return Err(
                            "Managed aMule process disappeared after EC readiness."
                                .to_string(),
                        );
                    };
                    if managed.child.id() != pid {
                        return Err(
                            "Managed aMule process changed during readiness check."
                                .to_string(),
                        );
                    }
                    managed.ready = true;
                    managed.status_output = Some(output.clone());
                    return Ok(status_from_layout(
                        &layout,
                        true,
                        true,
                        managed.child.id(),
                        Some(output),
                    ));
                }
                Err(error) => {
                    last_error = Some(error);
                }
            }
        }

        let mut process = self.process.lock().await;
        if let Some(mut managed) = process.take() {
            let _ = managed.child.kill().await;
            let _ = managed.child.wait().await;
        }
        Err(format!(
            "Bundled amuled started but its local External Connections endpoint did not become ready: {}",
            last_error.unwrap_or_else(|| "no Status response".to_string())
        ))
    }

    async fn connection_config(
        &self,
        app: &AppHandle,
    ) -> Result<Ed2kConnectionConfig, String> {
        let status = self.start(app).await?;
        if !status.available {
            return Err(
                "Bundled aMule runtime is not prepared. Run the runtime preparation step first."
                    .to_string(),
            );
        }
        if !status.running || !status.ready {
            return Err(
                "Managed aMule runtime is not ready for External Connections."
                    .to_string(),
            );
        }

        let layout = layout(app)?;
        let mut process = self.process.lock().await;
        let Some(managed) = process.as_mut() else {
            return Err(
                "Managed aMule process disappeared before creating its connection config."
                    .to_string(),
            );
        };

        match managed.child.try_wait() {
            Ok(None) if managed.ready => Ok(managed_connection_config(
                &layout,
                managed.control_password.clone(),
            )),
            Ok(None) => Err(
                "Managed aMule process is running but EC is not ready."
                    .to_string(),
            ),
            Ok(Some(_)) => {
                *process = None;
                Err(
                    "Managed aMule process exited before creating its connection config."
                        .to_string(),
                )
            }
            Err(error) => Err(format!(
                "Unable to inspect managed aMule process before creating its connection config: {error}"
            )),
        }
    }

    async fn enqueue_link(
        &self,
        app: &AppHandle,
        trimmed: &str,
        metadata: &Ed2kLinkMetadata,
    ) -> Result<ManagedAmuleEnqueueProbe, String> {
        let add_output = self
            .run_ready_command(app, &format!("Add {trimmed}"))
            .await?;

        let mut queue_output = String::new();
        let mut queue_verified = false;
        for attempt in 0..4 {
            if attempt > 0 {
                sleep(Duration::from_millis(250)).await;
            }
            queue_output = self.run_ready_command(app, "Show DL").await?;
            if queue_contains_hash(&queue_output, &metadata.hash) {
                queue_verified = true;
                break;
            }
        }

        if !queue_verified {
            return Err(format!(
                "Managed aMule accepted the ED2K Add command, but the expected hash {} did not appear in Show DL.",
                metadata.hash
            ));
        }

        Ok(ManagedAmuleEnqueueProbe {
            name: metadata.name.clone(),
            size: metadata.size,
            hash: metadata.hash.clone(),
            runtime_ready: true,
            add_output,
            queue_verified,
            queue_output,
        })
    }

    async fn run_ready_command(
        &self,
        app: &AppHandle,
        command_text: &str,
    ) -> Result<String, String> {
        let status = self.start(app).await?;
        if !status.available {
            return Err(
                "Bundled aMule runtime is not prepared. Run the runtime preparation step first."
                    .to_string(),
            );
        }
        if !status.running || !status.ready {
            return Err(
                "Managed aMule runtime is not ready for External Connections."
                    .to_string(),
            );
        }

        let layout = layout(app)?;
        let password = {
            let mut process = self.process.lock().await;
            let Some(managed) = process.as_mut() else {
                return Err(
                    "Managed aMule process disappeared before the control command."
                        .to_string(),
                );
            };

            match managed.child.try_wait() {
                Ok(None) if managed.ready => managed.control_password.clone(),
                Ok(None) => {
                    return Err(
                        "Managed aMule process is running but EC is not ready."
                            .to_string(),
                    )
                }
                Ok(Some(_)) => {
                    *process = None;
                    return Err(
                        "Managed aMule process exited before the control command."
                            .to_string(),
                    );
                }
                Err(error) => {
                    return Err(format!(
                        "Unable to inspect managed aMule process before the control command: {error}"
                    ))
                }
            }
        };

        run_control_command(&layout, &password, command_text).await
    }

    async fn stop(
        &self,
        app: &AppHandle,
    ) -> Result<ManagedAmuleRuntimeStatus, String> {
        let layout = layout(app)?;
        let mut process = self.process.lock().await;
        let Some(mut managed) = process.take() else {
            return Ok(status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            ));
        };
        drop(process);

        match managed.child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                let _ = run_control_command(
                    &layout,
                    &managed.control_password,
                    "Shutdown",
                )
                .await;

                let mut exited = false;
                for _ in 0..30 {
                    match managed.child.try_wait() {
                        Ok(Some(_)) => {
                            exited = true;
                            break;
                        }
                        Ok(None) => {
                            sleep(Duration::from_millis(100)).await;
                        }
                        Err(error) => {
                            return Err(format!(
                                "Unable to inspect managed aMule process while stopping it: {error}"
                            ));
                        }
                    }
                }

                if !exited {
                    managed
                        .child
                        .kill()
                        .await
                        .map_err(|error| {
                            format!(
                                "Unable to stop managed aMule runtime after graceful shutdown timeout: {error}"
                            )
                        })?;
                    let _ = managed.child.wait().await;
                }
            }
            Err(error) => {
                return Err(format!(
                    "Unable to inspect managed aMule process before stopping it: {error}"
                ))
            }
        }

        Ok(status_from_layout(
            &layout,
            false,
            false,
            None,
            None,
        ))
    }
}

#[tauri::command]
pub async fn resource_ed2k_runtime_status(
    app: AppHandle,
    manager: State<'_, ManagedAmuleRuntimeManager>,
) -> Result<ManagedAmuleRuntimeStatus, String> {
    manager.status(&app).await
}

#[tauri::command]
pub async fn resource_ed2k_runtime_start(
    app: AppHandle,
    manager: State<'_, ManagedAmuleRuntimeManager>,
) -> Result<ManagedAmuleRuntimeStatus, String> {
    manager.start(&app).await
}

#[tauri::command]
pub async fn resource_ed2k_runtime_stop(
    app: AppHandle,
    manager: State<'_, ManagedAmuleRuntimeManager>,
) -> Result<ManagedAmuleRuntimeStatus, String> {
    manager.stop(&app).await
}

fn validate_managed_link(link: &str) -> Result<(String, Ed2kLinkMetadata), String> {
    let trimmed = link.trim().to_string();
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("ED2K link contains invalid line breaks.".to_string());
    }

    let metadata = parse_ed2k_file_link(&trimmed)?;
    if !metadata.book_candidate {
        return Err(
            "LexiPane currently imports PDF/EPUB/MOBI/AZW/AZW3 files from ED2K."
                .to_string(),
        );
    }

    Ok((trimmed, metadata))
}

#[tauri::command]
pub async fn resource_ed2k_runtime_probe_add_link(
    app: AppHandle,
    manager: State<'_, ManagedAmuleRuntimeManager>,
    link: String,
) -> Result<ManagedAmuleEnqueueProbe, String> {
    let (trimmed, metadata) = validate_managed_link(&link)?;
    manager.enqueue_link(&app, &trimmed, &metadata).await
}

#[tauri::command]
pub async fn resource_ed2k_runtime_start_link_job(
    app: AppHandle,
    runtime_manager: State<'_, ManagedAmuleRuntimeManager>,
    ed2k_manager: State<'_, Ed2kManager>,
    job_id: String,
    link: String,
) -> Result<Ed2kStartResult, String> {
    let (trimmed, metadata) = validate_managed_link(&link)?;
    runtime_manager
        .enqueue_link(&app, &trimmed, &metadata)
        .await?;

    let config = runtime_manager.connection_config(&app).await?;
    attach_started_ed2k_link(
        app,
        ed2k_manager.inner().clone(),
        job_id,
        config,
        metadata,
    )
    .await
}

#[tauri::command]
pub async fn resource_ed2k_runtime_reattach_link_job(
    app: AppHandle,
    runtime_manager: State<'_, ManagedAmuleRuntimeManager>,
    ed2k_manager: State<'_, Ed2kManager>,
    job_id: String,
    name: String,
    size: Option<u64>,
    hash: String,
    paused: Option<bool>,
) -> Result<bool, String> {
    let manager = ed2k_manager.inner().clone();
    if ed2k_job_is_attached(&manager, &job_id).await {
        return Ok(true);
    }

    let normalized_hash = normalized_ed2k_hash(&hash)?;
    if name.trim().is_empty() {
        return Err(
            "Managed ED2K recovery requires the persisted file name."
                .to_string(),
        );
    }

    runtime_manager.start(&app).await?;
    let queue_output = runtime_manager
        .run_ready_command(&app, "Show DL")
        .await?;
    if !queue_contains_hash(&queue_output, &normalized_hash) {
        return Ok(false);
    }

    let config = runtime_manager.connection_config(&app).await?;
    attach_existing_ed2k_job(
        app,
        manager,
        job_id,
        config,
        name,
        size,
        Some(normalized_hash),
        paused.unwrap_or(false),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_names_follow_platform() {
        let name = executable_name("amuled");
        if cfg!(windows) {
            assert_eq!(name, "amuled.exe");
        } else {
            assert_eq!(name, "amuled");
        }
    }

    #[test]
    fn bounded_control_output_limits_large_responses() {
        let short = bounded_text("ok".to_string());
        assert_eq!(short, "ok");

        let large = "x".repeat(5000);
        let bounded = bounded_text(large);
        assert!(bounded.len() < 4200);
        assert!(bounded.contains("output truncated"));
    }

    #[test]
    fn normalizes_persisted_recovery_hashes() {
        assert_eq!(
            normalized_ed2k_hash(
                "0123456789ABCDEF0123456789ABCDEF"
            )
            .unwrap(),
            "0123456789abcdef0123456789abcdef"
        );
        assert!(normalized_ed2k_hash("1234").is_err());
        assert!(
            normalized_ed2k_hash(
                "0123456789abcdef0123456789abcdeg"
            )
            .is_err()
        );
    }

    #[test]
    fn queue_hash_match_is_case_insensitive_and_token_bounded() {
        let hash = "0123456789abcdef0123456789abcdef";
        let output = format!(
            "{}\tBook.epub\n\t [0.0%] 0/4",
            hash.to_ascii_uppercase()
        );
        assert!(queue_contains_hash(&output, hash));
        assert!(!queue_contains_hash(
            "x0123456789abcdef0123456789abcdefy Book.epub",
            hash,
        ));
    }

    #[test]
    fn managed_connection_config_uses_bundled_control_endpoint() {
        let root = std::env::temp_dir().join("lexipane-managed-config-test");
        let layout = ManagedAmuleLayout {
            runtime_dir: root.clone(),
            daemon_path: root.join(executable_name("amuled")),
            command_path: root.join(executable_name("amulecmd")),
            config_dir: root.join("config"),
            incoming_dir: root.join("incoming"),
            temp_dir: root.join("temp"),
        };

        let expected_command = path_string(&layout.command_path);
        let expected_incoming = path_string(&layout.incoming_dir);
        let config =
            managed_connection_config(&layout, "secret".to_string());
        assert_eq!(
            config.executable.as_deref(),
            Some(expected_command.as_str())
        );
        assert_eq!(config.host.as_deref(), Some("127.0.0.1"));
        assert_eq!(config.port, Some(EC_PORT));
        assert_eq!(config.password.as_deref(), Some("secret"));
        assert_eq!(
            config.incoming_dir.as_deref(),
            Some(expected_incoming.as_str())
        );
    }

    #[test]
    fn generated_control_password_is_nonempty_and_hex() {
        let password = generate_control_password();
        assert_eq!(password.len(), 32);
        assert!(password.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    #[test]
    fn status_reports_daemon_availability_from_layout() {
        let root = std::env::temp_dir().join(format!(
            "lexipane-amule-runtime-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let layout = ManagedAmuleLayout {
            runtime_dir: root.clone(),
            daemon_path: root.join(executable_name("amuled")),
            command_path: root.join(executable_name("amulecmd")),
            config_dir: root.join("data").join("config"),
            incoming_dir: root.join("data").join("incoming"),
            temp_dir: root.join("data").join("temp"),
        };

        assert!(
            !status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            )
            .available
        );
        fs::write(&layout.daemon_path, b"stub").unwrap();
        assert!(
            !status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            )
            .available
        );
        fs::write(&layout.command_path, b"stub").unwrap();
        assert!(
            status_from_layout(
                &layout,
                false,
                false,
                None,
                None,
            )
            .available
        );

        let ready = status_from_layout(
            &layout,
            true,
            true,
            Some(123),
            Some("ready".to_string()),
        );
        assert!(ready.running);
        assert!(ready.ready);
        assert_eq!(ready.pid, Some(123));
        assert_eq!(ready.status_output.as_deref(), Some("ready"));

        let _ = fs::remove_dir_all(root);
    }
}

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
    time::{sleep, Duration},
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
    pub pid: Option<u32>,
    pub runtime_dir: String,
    pub daemon_path: String,
    pub command_path: Option<String>,
    pub config_dir: String,
    pub incoming_dir: String,
    pub temp_dir: String,
    pub ec_port: u16,
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
    pid: Option<u32>,
) -> ManagedAmuleRuntimeStatus {
    ManagedAmuleRuntimeStatus {
        version: AMULE_RUNTIME_VERSION.to_string(),
        available: layout.daemon_path.is_file(),
        running,
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

impl ManagedAmuleRuntimeManager {
    async fn status(
        &self,
        app: &AppHandle,
    ) -> Result<ManagedAmuleRuntimeStatus, String> {
        let layout = layout(app)?;
        let mut process = self.process.lock().await;
        let Some(managed) = process.as_mut() else {
            return Ok(status_from_layout(&layout, false, None));
        };

        match managed.child.try_wait() {
            Ok(None) => Ok(status_from_layout(
                &layout,
                true,
                managed.child.id(),
            )),
            Ok(Some(_)) => {
                *process = None;
                Ok(status_from_layout(&layout, false, None))
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
        if !layout.daemon_path.is_file() {
            return Ok(status_from_layout(&layout, false, None));
        }

        let mut process = self.process.lock().await;
        if let Some(managed) = process.as_mut() {
            match managed.child.try_wait() {
                Ok(None) => {
                    return Ok(status_from_layout(
                        &layout,
                        true,
                        managed.child.id(),
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
            .stderr(Stdio::null());

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

        *process = Some(ManagedAmuleProcess { child });
        drop(process);

        sleep(Duration::from_millis(250)).await;
        let status = self.status(app).await?;
        if !status.running {
            return Err(
                "Bundled amuled exited during startup. Check the managed aMule configuration and runtime dependencies."
                    .to_string(),
            );
        }
        Ok(status)
    }

    async fn stop(
        &self,
        app: &AppHandle,
    ) -> Result<ManagedAmuleRuntimeStatus, String> {
        let layout = layout(app)?;
        let mut process = self.process.lock().await;
        let Some(mut managed) = process.take() else {
            return Ok(status_from_layout(&layout, false, None));
        };

        match managed.child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => {
                managed
                    .child
                    .kill()
                    .await
                    .map_err(|error| {
                        format!("Unable to stop managed aMule runtime: {error}")
                    })?;
                let _ = managed.child.wait().await;
            }
            Err(error) => {
                return Err(format!(
                    "Unable to inspect managed aMule process before stopping it: {error}"
                ))
            }
        }

        Ok(status_from_layout(&layout, false, None))
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

        assert!(!status_from_layout(&layout, false, None).available);
        fs::write(&layout.daemon_path, b"stub").unwrap();
        assert!(status_from_layout(&layout, false, None).available);

        let _ = fs::remove_dir_all(root);
    }
}

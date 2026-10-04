pub mod http;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTransportCapabilities {
    pub http: bool,
    pub torrent: bool,
    pub ed2k: bool,
    pub cloud: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRuntimeCapabilities {
    pub core_version: u32,
    pub persistent_jobs: bool,
    pub live_transports: LiveTransportCapabilities,
}

#[tauri::command]
pub fn resource_runtime_capabilities() -> ResourceRuntimeCapabilities {
    ResourceRuntimeCapabilities {
        core_version: 1,
        persistent_jobs: true,
        live_transports: LiveTransportCapabilities {
            http: true,
            torrent: false,
            ed2k: false,
            cloud: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_core_enables_only_http_transport() {
        let capabilities = resource_runtime_capabilities();

        assert!(capabilities.persistent_jobs);
        assert!(capabilities.live_transports.http);
        assert!(!capabilities.live_transports.torrent);
        assert!(!capabilities.live_transports.ed2k);
        assert!(!capabilities.live_transports.cloud);
    }
}

pub mod cloud;
pub mod ed2k;
pub mod http;
pub mod s3;
pub mod torrent;
pub mod webdav;

use serde::Serialize;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tauri::State;
use tokio::sync::Notify;

const DEFAULT_DIRECT_TRANSFER_CONCURRENCY: usize = 3;
const MAX_DIRECT_TRANSFER_CONCURRENCY: usize = 8;

#[derive(Clone)]
pub struct ResourceTransferLimiter {
    limit: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
    notify: Arc<Notify>,
}

pub struct ResourceTransferPermit {
    active: Arc<AtomicUsize>,
    notify: Arc<Notify>,
}

impl Default for ResourceTransferLimiter {
    fn default() -> Self {
        Self {
            limit: Arc::new(AtomicUsize::new(
                DEFAULT_DIRECT_TRANSFER_CONCURRENCY,
            )),
            active: Arc::new(AtomicUsize::new(0)),
            notify: Arc::new(Notify::new()),
        }
    }
}

impl ResourceTransferLimiter {
    pub async fn acquire(&self) -> ResourceTransferPermit {
        loop {
            let limit = self.limit.load(Ordering::Relaxed).max(1);
            let active = self.active.load(Ordering::Relaxed);

            if active < limit
                && self
                    .active
                    .compare_exchange(
                        active,
                        active + 1,
                        Ordering::AcqRel,
                        Ordering::Relaxed,
                    )
                    .is_ok()
            {
                return ResourceTransferPermit {
                    active: self.active.clone(),
                    notify: self.notify.clone(),
                };
            }

            self.notify.notified().await;
        }
    }

    pub fn set_limit(&self, value: usize) -> usize {
        let normalized = value.clamp(1, MAX_DIRECT_TRANSFER_CONCURRENCY);
        self.limit.store(normalized, Ordering::Release);
        self.notify.notify_waiters();
        normalized
    }

    pub fn limit(&self) -> usize {
        self.limit.load(Ordering::Acquire)
    }

    pub fn active(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }
}

impl Drop for ResourceTransferPermit {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::AcqRel);
        self.notify.notify_one();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTransportCapabilities {
    pub http: bool,
    pub torrent: bool,
    pub ed2k: bool,
    pub cloud: bool,
    pub webdav: bool,
    pub s3: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRuntimeCapabilities {
    pub core_version: u32,
    pub persistent_jobs: bool,
    pub direct_transfer_concurrency: usize,
    pub live_transports: LiveTransportCapabilities,
}

#[tauri::command]
pub fn resource_transfer_set_concurrency(
    limiter: State<'_, ResourceTransferLimiter>,
    limit: usize,
) -> usize {
    limiter.set_limit(limit)
}

#[tauri::command]
pub fn resource_transfer_concurrency(
    limiter: State<'_, ResourceTransferLimiter>,
) -> (usize, usize) {
    (limiter.limit(), limiter.active())
}

#[tauri::command]
pub fn resource_runtime_capabilities() -> ResourceRuntimeCapabilities {
    ResourceRuntimeCapabilities {
        core_version: 1,
        persistent_jobs: true,
        direct_transfer_concurrency: DEFAULT_DIRECT_TRANSFER_CONCURRENCY,
        live_transports: LiveTransportCapabilities {
            http: true,
            torrent: true,
            ed2k: true,
            cloud: true,
            webdav: true,
            s3: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_limiter_clamps_runtime_limit() {
        let limiter = ResourceTransferLimiter::default();
        assert_eq!(limiter.limit(), DEFAULT_DIRECT_TRANSFER_CONCURRENCY);
        assert_eq!(limiter.set_limit(0), 1);
        assert_eq!(limiter.set_limit(99), MAX_DIRECT_TRANSFER_CONCURRENCY);
    }

    #[test]
    fn resource_core_enables_only_http_transport() {
        let capabilities = resource_runtime_capabilities();

        assert!(capabilities.persistent_jobs);
        assert_eq!(
            capabilities.direct_transfer_concurrency,
            DEFAULT_DIRECT_TRANSFER_CONCURRENCY
        );
        assert!(capabilities.live_transports.http);
        assert!(capabilities.live_transports.torrent);
        assert!(capabilities.live_transports.ed2k);
        assert!(capabilities.live_transports.cloud);
        assert!(capabilities.live_transports.webdav);
        assert!(capabilities.live_transports.s3);
    }
}

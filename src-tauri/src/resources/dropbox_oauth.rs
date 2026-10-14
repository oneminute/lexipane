use std::{collections::HashMap, time::Duration};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{oneshot, Mutex},
    time::timeout,
};

const CALLBACK_PORT: u16 = 53682;
const CALLBACK_PATH: &str = "/dropbox/callback";
const CALLBACK_TIMEOUT_SECS: u64 = 180;

#[derive(Default)]
pub struct DropboxOAuthManager {
    pending: Mutex<HashMap<String, oneshot::Receiver<Result<String, String>>>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxOAuthListener {
    pub redirect_uri: String,
}

fn get_callback_code(request: &str, expected_state: &str) -> Result<Option<String>, String> {
    let first = request.lines().next().unwrap_or_default();
    let target = match first.split_whitespace().collect::<Vec<_>>().as_slice() {
        ["GET", target, _] => *target,
        _ => return Err("Invalid Dropbox callback request.".into()),
    };
    let url = url::Url::parse(&format!("http://127.0.0.1:{CALLBACK_PORT}{target}"))
        .map_err(|_| "Invalid Dropbox callback URL.".to_string())?;
    if url.path() != CALLBACK_PATH {
        return Ok(None);
    }
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err("Dropbox authorization state mismatch.".into());
    }
    if let Some(error) = params.get("error") {
        return Err(format!("Dropbox authorization denied: {error}"));
    }
    let code = params.get("code").cloned().unwrap_or_default();
    if code.is_empty() {
        return Err("Dropbox callback did not include an authorization code.".into());
    }
    Ok(Some(code))
}

#[tauri::command]
pub async fn resource_dropbox_oauth_start(
    manager: State<'_, DropboxOAuthManager>,
    state: String,
) -> Result<DropboxOAuthListener, String> {
    if state.len() < 20 || state.len() > 256 || !state.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Invalid Dropbox OAuth state.".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", CALLBACK_PORT))
        .await
        .map_err(|e| format!("Dropbox callback port {CALLBACK_PORT} is unavailable: {e}"))?;
    let (sender, receiver) = oneshot::channel();
    manager.pending.lock().await.insert(state.clone(), receiver);
    tokio::spawn(async move {
        let result = timeout(Duration::from_secs(CALLBACK_TIMEOUT_SECS), async {
            loop {
                let (mut socket, _) = listener.accept().await.map_err(|e| e.to_string())?;
                let mut buffer = [0u8; 4096];
                let read = timeout(Duration::from_secs(10), socket.read(&mut buffer))
                    .await.map_err(|_| "Dropbox callback read timed out.".to_string())?
                    .map_err(|e| e.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..read]);
                let response = get_callback_code(&request, &state);
                let (status, html) = match &response {
                    Ok(Some(_)) => ("200 OK", "Authorization complete. Return to LexiPane."),
                    Ok(None) => ("404 Not Found", "Not a Dropbox callback."),
                    Err(_) => ("400 Bad Request", "Dropbox authorization was not completed. Return to LexiPane."),
                };
                let reply = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{html}",
                    html.len()
                );
                let _ = socket.write_all(reply.as_bytes()).await;
                if let Ok(Some(code)) = response {
                    return Ok(code);
                }
                if let Err(error) = response {
                    if error != "Invalid Dropbox callback request." {
                        return Err(error);
                    }
                }
            }
        }).await.unwrap_or_else(|_| Err("Dropbox authorization timed out.".into()));
        let _ = sender.send(result);
    });
    Ok(DropboxOAuthListener {
        redirect_uri: format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}"),
    })
}

#[tauri::command]
pub async fn resource_dropbox_oauth_wait(
    manager: State<'_, DropboxOAuthManager>,
    state: String,
) -> Result<String, String> {
    let receiver = manager.pending.lock().await.remove(&state)
        .ok_or_else(|| "Dropbox authorization session not found.".to_string())?;
    receiver.await.map_err(|_| "Dropbox authorization listener closed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_matching_callback() {
        let request = "GET /dropbox/callback?code=abc&state=correct HTTP/1.1\r\n";
        assert_eq!(get_callback_code(request, "correct").unwrap(), Some("abc".into()));
    }
    #[test]
    fn rejects_wrong_state() {
        let request = "GET /dropbox/callback?code=abc&state=wrong HTTP/1.1\r\n";
        assert!(get_callback_code(request, "correct").is_err());
    }
    #[test]
    fn ignores_unrelated_paths() {
        assert_eq!(get_callback_code("GET /favicon.ico HTTP/1.1", "correct").unwrap(), None);
    }
}

const SERVICE: &str = "com.lexipane.reader.ai";

fn validate_account(account: &str) -> Result<(), String> {
    if account.trim().is_empty() {
        return Err("Secret account cannot be empty.".to_string());
    }

    if account.len() > 240 {
        return Err("Secret account is too long.".to_string());
    }

    Ok(())
}

#[cfg(any(
    windows,
    target_os = "linux",
    target_os = "macos",
    target_os = "ios"
))]
fn entry(account: &str) -> Result<keyring::Entry, String> {
    validate_account(account)?;
    keyring::Entry::new(SERVICE, account).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
    if secret.is_empty() {
        return Err("Secret value cannot be empty.".to_string());
    }

    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    ))]
    {
        return entry(&account)?
            .set_password(&secret)
            .map_err(|error| error.to_string());
    }

    #[cfg(not(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    )))]
    {
        let _ = (account, secret);
        Err("Secure credential storage is not implemented on this platform yet.".to_string())
    }
}

#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    ))]
    {
        let entry = entry(&account)?;
        return match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(error) => {
                // keyring exposes NoEntry cross-platform, but keep this tolerant
                // of backend-specific formatting so an absent secret is not fatal.
                let debug = format!("{error:?}");
                if debug.contains("NoEntry") {
                    Ok(None)
                } else {
                    Err(error.to_string())
                }
            }
        };
    }

    #[cfg(not(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    )))]
    {
        let _ = account;
        Err("Secure credential storage is not implemented on this platform yet.".to_string())
    }
}

#[tauri::command]
pub fn secret_has(account: String) -> Result<bool, String> {
    Ok(secret_get(account)?.is_some())
}

#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    #[cfg(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    ))]
    {
        let entry = entry(&account)?;
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(error) => {
                let debug = format!("{error:?}");
                if debug.contains("NoEntry") {
                    Ok(())
                } else {
                    Err(error.to_string())
                }
            }
        };
    }

    #[cfg(not(any(
        windows,
        target_os = "linux",
        target_os = "macos",
        target_os = "ios"
    )))]
    {
        let _ = account;
        Err("Secure credential storage is not implemented on this platform yet.".to_string())
    }
}

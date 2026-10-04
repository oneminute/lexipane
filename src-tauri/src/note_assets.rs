use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as FmtWrite,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredNoteAsset {
    path: String,
    file_hash: String,
    mime_type: String,
}

fn asset_hash(bytes: &[u8]) -> Result<String, String> {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);

    for byte in digest {
        write!(&mut output, "{byte:02x}")
            .map_err(|error| error.to_string())?;
    }

    Ok(output)
}

fn extension_for_mime(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err("Unsupported notebook image type.".to_string()),
    }
}

fn note_asset_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data.join("notebook-assets"))
}

fn ensure_note_asset_child(
    app: &tauri::AppHandle,
    path: &Path,
) -> Result<PathBuf, String> {
    let asset_dir = note_asset_dir(app)?;
    let canonical_dir = fs::canonicalize(&asset_dir)
        .map_err(|error| format!("Notebook asset storage is unavailable: {error}"))?;
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("Notebook asset is unavailable: {error}"))?;

    if canonical_path.parent() != Some(canonical_dir.as_path()) {
        return Err("Refusing to delete a file outside notebook asset storage.".to_string());
    }

    Ok(canonical_path)
}

#[tauri::command]
pub fn save_note_asset(
    app: tauri::AppHandle,
    image_bytes: Vec<u8>,
    mime_type: String,
) -> Result<StoredNoteAsset, String> {
    if image_bytes.is_empty() {
        return Err("Notebook image is empty.".to_string());
    }

    let extension = extension_for_mime(&mime_type)?;
    let file_hash = asset_hash(&image_bytes)?;
    let asset_dir = note_asset_dir(&app)?;

    fs::create_dir_all(&asset_dir)
        .map_err(|error| format!("Unable to create notebook asset storage: {error}"))?;

    let target = asset_dir.join(format!("{file_hash}.{extension}"));

    if !target.exists() {
        fs::write(&target, &image_bytes)
            .map_err(|error| format!("Unable to save notebook image: {error}"))?;
    }

    Ok(StoredNoteAsset {
        path: target.to_string_lossy().to_string(),
        file_hash,
        mime_type,
    })
}

#[tauri::command]
pub fn delete_note_asset(
    app: tauri::AppHandle,
    path: String,
) -> Result<bool, String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Ok(false);
    }

    let canonical = ensure_note_asset_child(&app, target)?;

    fs::remove_file(&canonical)
        .map_err(|error| format!("Unable to delete notebook image: {error}"))?;

    Ok(true)
}

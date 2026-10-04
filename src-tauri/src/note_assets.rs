use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAssetCleanupResult {
    files_removed: u64,
    bytes_removed: u64,
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


#[tauri::command]
pub fn cleanup_note_assets(
    app: tauri::AppHandle,
    keep_paths: Vec<String>,
) -> Result<NoteAssetCleanupResult, String> {
    let asset_dir = note_asset_dir(&app)?;

    if !asset_dir.exists() {
        return Ok(NoteAssetCleanupResult {
            files_removed: 0,
            bytes_removed: 0,
        });
    }

    let canonical_dir = fs::canonicalize(&asset_dir)
        .map_err(|error| format!("Notebook asset storage is unavailable: {error}"))?;

    let keep: HashSet<PathBuf> = keep_paths
        .iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.parent() == Some(canonical_dir.as_path()))
        .collect();

    let mut files_removed = 0_u64;
    let mut bytes_removed = 0_u64;

    for entry in fs::read_dir(&canonical_dir)
        .map_err(|error| format!("Unable to inspect notebook asset storage: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Unable to inspect notebook asset entry: {error}"))?;
        let path = entry.path();

        if !path.is_file() || keep.contains(&path) {
            continue;
        }

        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);

        fs::remove_file(&path)
            .map_err(|error| format!("Unable to remove orphan notebook asset: {error}"))?;

        files_removed += 1;
        bytes_removed += size;
    }

    Ok(NoteAssetCleanupResult {
        files_removed,
        bytes_removed,
    })
}

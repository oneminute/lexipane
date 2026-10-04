use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as FmtWrite,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
};
use std::collections::HashSet;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFileStatus {
    path: String,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedBookCopy {
    path: String,
    file_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedCleanupResult {
    files_removed: u64,
    bytes_removed: u64,
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let file = File::open(path)
        .map_err(|error| format!("Unable to open book for hashing: {error}"))?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read book for hashing: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    let digest = hasher.finalize();
    let mut output = String::with_capacity(64);

    for byte in digest {
        write!(&mut output, "{byte:02x}")
            .map_err(|error| error.to_string())?;
    }

    Ok(output)
}

fn managed_target_path(
    app: &tauri::AppHandle,
    source: &Path,
    file_hash: &str,
) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let library_dir = app_data.join("library");

    fs::create_dir_all(&library_dir)
        .map_err(|error| format!("Unable to create managed library: {error}"))?;

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "book".to_string());

    Ok(library_dir.join(format!("{file_hash}.{extension}")))
}

#[tauri::command]
pub fn book_file_sha256(path: String) -> Result<String, String> {
    sha256_file(Path::new(&path))
}

#[tauri::command]
pub fn check_book_files(paths: Vec<String>) -> Vec<BookFileStatus> {
    paths
        .into_iter()
        .map(|path| {
            let exists = Path::new(&path).is_file();
            BookFileStatus { path, exists }
        })
        .collect()
}

#[tauri::command]
pub fn copy_book_to_managed_library(
    app: tauri::AppHandle,
    path: String,
) -> Result<ManagedBookCopy, String> {
    let source = Path::new(&path);

    if !source.is_file() {
        return Err("The source book file does not exist.".to_string());
    }

    let file_hash = sha256_file(source)?;
    let target = managed_target_path(&app, source, &file_hash)?;

    if target != source && !target.exists() {
        fs::copy(source, &target)
            .map_err(|error| format!("Unable to copy book into LexiPane: {error}"))?;
    }

    Ok(ManagedBookCopy {
        path: target.to_string_lossy().to_string(),
        file_hash,
    })
}


fn managed_library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data.join("library"))
}

fn ensure_managed_child(
    app: &tauri::AppHandle,
    path: &Path,
) -> Result<PathBuf, String> {
    let library_dir = managed_library_dir(app)?;
    let canonical_library = fs::canonicalize(&library_dir)
        .map_err(|error| format!("Managed library is unavailable: {error}"))?;
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("Managed book file is unavailable: {error}"))?;

    if canonical_path.parent() != Some(canonical_library.as_path()) {
        return Err("Refusing to delete a file outside the managed library.".to_string());
    }

    Ok(canonical_path)
}

#[tauri::command]
pub fn delete_managed_book_copy(
    app: tauri::AppHandle,
    path: String,
) -> Result<bool, String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Ok(false);
    }

    let canonical = ensure_managed_child(&app, target)?;

    fs::remove_file(&canonical)
        .map_err(|error| format!("Unable to delete managed book copy: {error}"))?;

    Ok(true)
}

#[tauri::command]
pub fn cleanup_managed_library(
    app: tauri::AppHandle,
    keep_paths: Vec<String>,
) -> Result<ManagedCleanupResult, String> {
    let library_dir = managed_library_dir(&app)?;

    if !library_dir.exists() {
        return Ok(ManagedCleanupResult {
            files_removed: 0,
            bytes_removed: 0,
        });
    }

    let canonical_library = fs::canonicalize(&library_dir)
        .map_err(|error| format!("Managed library is unavailable: {error}"))?;

    let keep: HashSet<PathBuf> = keep_paths
        .iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.parent() == Some(canonical_library.as_path()))
        .collect();

    let mut files_removed = 0_u64;
    let mut bytes_removed = 0_u64;

    for entry in fs::read_dir(&canonical_library)
        .map_err(|error| format!("Unable to inspect managed library: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Unable to inspect managed library entry: {error}"))?;
        let path = entry.path();

        if !path.is_file() || keep.contains(&path) {
            continue;
        }

        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);

        fs::remove_file(&path)
            .map_err(|error| format!("Unable to remove orphan managed file: {error}"))?;

        files_removed += 1;
        bytes_removed += size;
    }

    Ok(ManagedCleanupResult {
        files_removed,
        bytes_removed,
    })
}

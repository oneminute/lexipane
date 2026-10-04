use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as FmtWrite,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
};
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

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fmt::Write as FmtWrite,
    fs::File,
    io::{BufReader, Read},
    path::Path,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFileStatus {
    path: String,
    exists: bool,
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

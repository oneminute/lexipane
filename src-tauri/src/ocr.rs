use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    available: bool,
    engine: String,
    executable: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    text: String,
    engine: String,
    language: String,
}

fn candidate_executables() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("tesseract")];

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        ));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/tesseract"));
        candidates.push(PathBuf::from("/usr/local/bin/tesseract"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/tesseract"));
        candidates.push(PathBuf::from("/usr/local/bin/tesseract"));
    }

    candidates
}

fn find_tesseract() -> Option<PathBuf> {
    for candidate in candidate_executables() {
        let result = Command::new(&candidate)
            .arg("--version")
            .output();

        if result.map(|output| output.status.success()).unwrap_or(false) {
            return Some(candidate);
        }
    }

    None
}

fn safe_language(value: Option<String>) -> String {
    let requested = value.unwrap_or_else(|| "eng".to_string());
    let filtered: String = requested
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || *character == '+'
                || *character == '_'
                || *character == '-'
        })
        .collect();

    if filtered.is_empty() {
        "eng".to_string()
    } else {
        filtered
    }
}

fn temporary_png_path() -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();

    Ok(std::env::temp_dir().join(format!(
        "lexipane-ocr-{}-{}.png",
        std::process::id(),
        timestamp
    )))
}

fn executable_label(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[tauri::command]
pub fn local_ocr_status() -> OcrStatus {
    match find_tesseract() {
        Some(executable) => OcrStatus {
            available: true,
            engine: "Tesseract OCR".to_string(),
            executable: Some(executable_label(&executable)),
            message: "Local OCR is ready.".to_string(),
        },
        None => OcrStatus {
            available: false,
            engine: "Tesseract OCR".to_string(),
            executable: None,
            message: concat!(
                "Tesseract OCR was not found. Install it locally to OCR scanned ",
                "pages without sending images to a cloud model."
            )
            .to_string(),
        },
    }
}

#[tauri::command]
pub fn ocr_image(
    image_bytes: Vec<u8>,
    language: Option<String>,
) -> Result<OcrResult, String> {
    if image_bytes.is_empty() {
        return Err("OCR image is empty.".to_string());
    }

    let executable = find_tesseract().ok_or_else(|| {
        concat!(
            "Tesseract OCR is not installed or is not visible in PATH. ",
            "On Windows you can install a local Tesseract build, then restart LexiPane."
        )
        .to_string()
    })?;

    let language = safe_language(language);
    let temporary_path = temporary_png_path()?;

    fs::write(&temporary_path, image_bytes)
        .map_err(|error| format!("Unable to prepare OCR image: {error}"))?;

    let output = Command::new(&executable)
        .arg(&temporary_path)
        .arg("stdout")
        .arg("-l")
        .arg(&language)
        .arg("--psm")
        .arg("6")
        .output();

    let _ = fs::remove_file(&temporary_path);

    let output = output.map_err(|error| {
        format!("Unable to start local Tesseract OCR: {error}")
    })?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_string();

        return Err(if detail.is_empty() {
            "Local OCR failed.".to_string()
        } else {
            format!("Local OCR failed: {detail}")
        });
    }

    let text = String::from_utf8_lossy(&output.stdout)
        .replace("\r\n", "\n")
        .trim()
        .to_string();

    Ok(OcrResult {
        text,
        engine: "Tesseract OCR".to_string(),
        language,
    })
}

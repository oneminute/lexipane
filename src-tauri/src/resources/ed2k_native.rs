use flate2::read::ZlibDecoder;
use futures_util::future::join_all;
use md5::{Digest, Md5};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Read,
    net::Ipv4Addr,
    path::PathBuf,
    process,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::{timeout, Instant},
};

const SERVER_MET_URL: &str = "https://upd.emule-security.org/server.met";
const SERVER_MET_CACHE_SECONDS: u64 = 6 * 60 * 60;
const DEFAULT_QUERY_SERVERS: usize = 6;
const MAX_QUERY_SERVERS: usize = 10;
const MAX_SERVER_COUNT: usize = 10_000;
const MAX_PACKET_SIZE: usize = 8 * 1024 * 1024;
const MAX_RESULTS_PER_PACKET: usize = 20_000;
const MAX_TAGS_PER_RECORD: usize = 512;

const OP_EDONKEYPROT: u8 = 0xE3;
const OP_PACKEDPROT: u8 = 0xD4;
const OP_LOGINREQUEST: u8 = 0x01;
const OP_REJECT: u8 = 0x05;
const OP_SEARCHREQUEST: u8 = 0x16;
const OP_SEARCHRESULT: u8 = 0x33;
const OP_IDCHANGE: u8 = 0x40;

const CT_NAME: u8 = 0x01;
const CT_VERSION: u8 = 0x11;
const CT_SERVER_FLAGS: u8 = 0x20;
const CT_EMULE_VERSION: u8 = 0xFB;
const EDONKEY_VERSION: u32 = 0x3C;
const SERVER_FLAGS: u32 = 0x0000_011D;
const LEXIPANE_EMULE_VERSION: u32 = (3u32 << 24) | (3u32 << 17);

const FT_FILENAME: u8 = 0x01;
const FT_FILESIZE: u8 = 0x02;
const FT_FILESIZE_HI: u8 = 0x3A;
const FT_SOURCES: u8 = 0x15;
const FT_COMPLETE_SOURCES: u8 = 0x30;

const ST_SERVERNAME: u8 = 0x01;
const ST_FAIL: u8 = 0x0D;
const ST_PREFERENCE: u8 = 0x0E;
const ST_DYNIP: u8 = 0x85;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEd2kServer {
    pub address: String,
    pub port: u16,
    pub name: Option<String>,
    pub users: Option<u64>,
    pub files: Option<u64>,
    pub failed_count: u64,
    pub preference: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEd2kSearchResult {
    pub hash: String,
    pub name: String,
    pub size: u64,
    pub sources: u64,
    pub complete_sources: u64,
    pub book_candidate: bool,
    pub ed2k_link: String,
    pub servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEd2kSearchResponse {
    pub query: String,
    pub server_list_source: String,
    pub servers_loaded: usize,
    pub servers_queried: usize,
    pub servers_succeeded: usize,
    pub results: Vec<NativeEd2kSearchResult>,
    pub errors: Vec<String>,
}

#[derive(Debug)]
struct Ed2kPacket {
    opcode: u8,
    payload: Vec<u8>,
}

#[derive(Debug, Clone)]
enum TagValue {
    String(String),
    Integer(u64),
    Hash,
    Other,
}

#[derive(Debug, Clone)]
struct ParsedTag {
    name_id: Option<u8>,
    name: Option<String>,
    value: TagValue,
}

struct ByteCursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn bytes(&mut self, count: usize) -> Result<&'a [u8], String> {
        if count > self.remaining() {
            return Err(format!(
                "ED2K packet is truncated at offset {} (need {}, have {}).",
                self.pos,
                count,
                self.remaining()
            ));
        }

        let start = self.pos;
        self.pos += count;
        Ok(&self.data[start..start + count])
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        let bytes = self.bytes(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Result<u32, String> {
        let bytes = self.bytes(4)?;
        Ok(u32::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3],
        ]))
    }

    fn u64(&mut self) -> Result<u64, String> {
        let bytes = self.bytes(8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    fn string_u16(&mut self) -> Result<String, String> {
        let length = self.u16()? as usize;
        Ok(decode_text(self.bytes(length)?))
    }
}

fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes
        .strip_prefix(&[0xEF, 0xBB, 0xBF])
        .unwrap_or(bytes);

    match std::str::from_utf8(bytes) {
        Ok(value) => value.to_string(),
        Err(_) => bytes.iter().map(|value| char::from(*value)).collect(),
    }
}

fn read_tag(cursor: &mut ByteCursor<'_>) -> Result<ParsedTag, String> {
    let raw_type = cursor.u8()?;
    let (tag_type, name_id, name) = if raw_type & 0x80 != 0 {
        (raw_type & 0x7F, Some(cursor.u8()?), None)
    } else {
        let name_length = cursor.u16()? as usize;
        if name_length == 0 {
            return Err("ED2K tag has an empty name.".to_string());
        }

        let raw_name = cursor.bytes(name_length)?;
        if name_length == 1 {
            (raw_type, Some(raw_name[0]), None)
        } else {
            (raw_type, None, Some(decode_text(raw_name)))
        }
    };

    let value = match tag_type {
        0x01 => {
            let _ = cursor.bytes(16)?;
            TagValue::Hash
        }
        0x02 => TagValue::String(cursor.string_u16()?),
        0x03 => TagValue::Integer(cursor.u32()? as u64),
        0x04 => {
            let _ = cursor.bytes(4)?;
            TagValue::Other
        }
        0x05 => {
            let _ = cursor.u8()?;
            TagValue::Other
        }
        0x06 => {
            let bit_count = cursor.u16()? as usize;
            let _ = cursor.bytes((bit_count / 8) + 1)?;
            TagValue::Other
        }
        0x07 => {
            let length = cursor.u32()? as usize;
            let _ = cursor.bytes(length)?;
            TagValue::Other
        }
        0x08 => TagValue::Integer(cursor.u16()? as u64),
        0x09 => TagValue::Integer(cursor.u8()? as u64),
        0x0A => {
            let length = cursor.u8()? as usize;
            let _ = cursor.bytes(length)?;
            TagValue::Other
        }
        0x0B => TagValue::Integer(cursor.u64()?),
        0x11..=0x26 => {
            let length = (tag_type - 0x11 + 1) as usize;
            TagValue::String(decode_text(cursor.bytes(length)?))
        }
        _ => {
            return Err(format!(
                "Unsupported ED2K tag type 0x{tag_type:02x}."
            ))
        }
    };

    Ok(ParsedTag {
        name_id,
        name,
        value,
    })
}

fn tag_integer(tag: &ParsedTag) -> Option<u64> {
    match tag.value {
        TagValue::Integer(value) => Some(value),
        _ => None,
    }
}

fn tag_string(tag: &ParsedTag) -> Option<&str> {
    match &tag.value {
        TagValue::String(value) => Some(value),
        _ => None,
    }
}

pub fn parse_server_met(data: &[u8]) -> Result<Vec<NativeEd2kServer>, String> {
    let mut cursor = ByteCursor::new(data);
    let version = cursor.u8()?;
    if version != 0xE0 && version != 0x0E {
        return Err(format!(
            "Unsupported server.met version 0x{version:02x}."
        ));
    }

    let count = cursor.u32()? as usize;
    if count > MAX_SERVER_COUNT {
        return Err(format!(
            "server.met declares an unreasonable server count: {count}."
        ));
    }

    let mut servers = Vec::with_capacity(count);

    for _ in 0..count {
        let raw_ip = cursor.u32()?;
        let port = cursor.u16()?;
        let tag_count = cursor.u32()? as usize;
        if tag_count > MAX_TAGS_PER_RECORD {
            return Err(format!(
                "server.met record has too many tags: {tag_count}."
            ));
        }

        let mut name = None;
        let mut dyn_ip = None;
        let mut users = None;
        let mut files = None;
        let mut failed_count = 0;
        let mut preference = 0;

        for _ in 0..tag_count {
            let tag = read_tag(&mut cursor)?;
            match tag.name_id {
                Some(ST_SERVERNAME) => {
                    if let Some(value) = tag_string(&tag) {
                        name = Some(value.to_string());
                    }
                }
                Some(ST_DYNIP) => {
                    if let Some(value) = tag_string(&tag) {
                        dyn_ip = Some(value.to_string());
                    }
                }
                Some(ST_FAIL) => {
                    failed_count = tag_integer(&tag).unwrap_or(0);
                }
                Some(ST_PREFERENCE) => {
                    preference = tag_integer(&tag).unwrap_or(0);
                }
                _ => {
                    if let Some(tag_name) = tag.name.as_deref() {
                        if tag_name.eq_ignore_ascii_case("users") {
                            users = tag_integer(&tag);
                        } else if tag_name.eq_ignore_ascii_case("files") {
                            files = tag_integer(&tag);
                        }
                    }
                }
            }
        }

        if port == 0 {
            continue;
        }

        let address = if let Some(dyn_ip) = dyn_ip
            .filter(|value| !value.trim().is_empty())
        {
            dyn_ip
        } else if raw_ip != 0 {
            Ipv4Addr::from(raw_ip.to_le_bytes()).to_string()
        } else {
            continue;
        };

        servers.push(NativeEd2kServer {
            address,
            port,
            name,
            users,
            files,
            failed_count,
            preference,
        });
    }

    servers.sort_by(|left, right| {
        left.failed_count
            .cmp(&right.failed_count)
            .then_with(|| {
                server_preference_rank(left.preference)
                    .cmp(&server_preference_rank(right.preference))
            })
            .then_with(|| right.users.unwrap_or(0).cmp(&left.users.unwrap_or(0)))
            .then_with(|| right.files.unwrap_or(0).cmp(&left.files.unwrap_or(0)))
    });

    Ok(servers)
}

fn server_preference_rank(value: u64) -> u8 {
    match value {
        1 => 0,
        0 => 1,
        2 => 2,
        _ => 3,
    }
}

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_string_u16(buffer: &mut Vec<u8>, value: &str) -> Result<(), String> {
    let bytes = value.as_bytes();
    let length = u16::try_from(bytes.len())
        .map_err(|_| "ED2K string is too long.".to_string())?;
    push_u16(buffer, length);
    buffer.extend_from_slice(bytes);
    Ok(())
}

fn push_old_string_tag(
    buffer: &mut Vec<u8>,
    name_id: u8,
    value: &str,
) -> Result<(), String> {
    buffer.push(0x02);
    push_u16(buffer, 1);
    buffer.push(name_id);
    push_string_u16(buffer, value)
}

fn push_old_u32_tag(buffer: &mut Vec<u8>, name_id: u8, value: u32) {
    buffer.push(0x03);
    push_u16(buffer, 1);
    buffer.push(name_id);
    push_u32(buffer, value);
}

fn make_user_hash() -> [u8; 16] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let seed = format!("LexiPane Native ED2K:{}:{nanos}", process::id());
    let digest = Md5::digest(seed.as_bytes());
    let mut hash = [0u8; 16];
    hash.copy_from_slice(&digest[..16]);

    // eMule/aMule-style markers make this look like a normal modern client
    // hash while keeping the value ephemeral for this search-only client.
    hash[5] = 14;
    hash[14] = 111;
    hash
}

fn login_payload() -> Result<Vec<u8>, String> {
    let mut payload = Vec::with_capacity(128);
    payload.extend_from_slice(&make_user_hash());
    push_u32(&mut payload, 0);
    push_u16(&mut payload, 4662);
    push_u32(&mut payload, 4);

    push_old_string_tag(&mut payload, CT_NAME, "LexiPane")?;
    push_old_u32_tag(&mut payload, CT_VERSION, EDONKEY_VERSION);
    push_old_u32_tag(&mut payload, CT_SERVER_FLAGS, SERVER_FLAGS);
    push_old_u32_tag(
        &mut payload,
        CT_EMULE_VERSION,
        LEXIPANE_EMULE_VERSION,
    );

    Ok(payload)
}

fn encode_packet(opcode: u8, payload: &[u8]) -> Result<Vec<u8>, String> {
    let packet_length = payload
        .len()
        .checked_add(1)
        .ok_or_else(|| "ED2K packet length overflow.".to_string())?;
    let packet_length = u32::try_from(packet_length)
        .map_err(|_| "ED2K packet is too large.".to_string())?;

    let mut packet = Vec::with_capacity(payload.len() + 6);
    packet.push(OP_EDONKEYPROT);
    packet.extend_from_slice(&packet_length.to_le_bytes());
    packet.push(opcode);
    packet.extend_from_slice(payload);
    Ok(packet)
}

async fn read_packet(stream: &mut TcpStream) -> Result<Ed2kPacket, String> {
    let mut header = [0u8; 6];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| format!("Unable to read ED2K packet header: {error}"))?;

    let protocol = header[0];
    if protocol != OP_EDONKEYPROT
        && protocol != OP_PACKEDPROT
        && protocol != 0xC5
    {
        return Err(format!(
            "Unexpected ED2K TCP protocol byte 0x{protocol:02x}."
        ));
    }

    let packet_length = u32::from_le_bytes([
        header[1], header[2], header[3], header[4],
    ]) as usize;
    if packet_length < 1 {
        return Err("ED2K TCP packet has an invalid zero length.".to_string());
    }

    let payload_length = packet_length - 1;
    if payload_length > MAX_PACKET_SIZE {
        return Err(format!(
            "ED2K TCP packet is too large: {payload_length} bytes."
        ));
    }

    let mut payload = vec![0u8; payload_length];
    stream
        .read_exact(&mut payload)
        .await
        .map_err(|error| format!("Unable to read ED2K packet body: {error}"))?;

    if protocol == OP_PACKEDPROT {
        let mut decoder = ZlibDecoder::new(payload.as_slice());
        let mut unpacked = Vec::new();
        decoder
            .read_to_end(&mut unpacked)
            .map_err(|error| format!("Unable to decompress ED2K packet: {error}"))?;
        if unpacked.len() > MAX_PACKET_SIZE {
            return Err("Decompressed ED2K packet is too large.".to_string());
        }
        payload = unpacked;
    }

    Ok(Ed2kPacket {
        opcode: header[5],
        payload,
    })
}

fn query_terms(query: &str) -> Result<Vec<&str>, String> {
    let terms = query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .take(16)
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Err("ED2K search query is empty.".to_string());
    }

    Ok(terms)
}

fn write_query_term(buffer: &mut Vec<u8>, term: &str) -> Result<(), String> {
    buffer.push(0x01);
    push_string_u16(buffer, term)
}

fn write_query_tree(buffer: &mut Vec<u8>, terms: &[&str]) -> Result<(), String> {
    match terms {
        [] => Err("ED2K search query is empty.".to_string()),
        [term] => write_query_term(buffer, term),
        _ => {
            // ED2K search expressions are prefix trees. Build
            // (...((term1 AND term2) AND term3)...) so plain text searches
            // retain the usual all-words semantics.
            buffer.push(0x00);
            buffer.push(0x00);
            write_query_tree(buffer, &terms[..terms.len() - 1])?;
            write_query_tree(buffer, &terms[terms.len() - 1..])
        }
    }
}

fn search_payload(query: &str) -> Result<Vec<u8>, String> {
    let query = query.trim();
    if query.len() > 512 {
        return Err("ED2K search query is too long.".to_string());
    }
    if query.contains('\n') || query.contains('\r') {
        return Err("ED2K search query contains invalid characters.".to_string());
    }

    let terms = query_terms(query)?;
    let mut payload = Vec::with_capacity(query.len() + 16);
    write_query_tree(&mut payload, &terms)?;
    Ok(payload)
}

fn hash_hex(hash: &[u8]) -> String {
    hash.iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn is_book_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".pdf")
        || lower.ends_with(".epub")
        || lower.ends_with(".mobi")
        || lower.ends_with(".azw")
        || lower.ends_with(".azw3")
}

fn parse_search_results(
    payload: &[u8],
    server: &NativeEd2kServer,
) -> Result<Vec<NativeEd2kSearchResult>, String> {
    let mut cursor = ByteCursor::new(payload);
    let count = cursor.u32()? as usize;
    if count > MAX_RESULTS_PER_PACKET {
        return Err(format!(
            "ED2K server returned an unreasonable result count: {count}."
        ));
    }

    let server_label = format!(
        "{}:{}",
        server.address,
        server.port
    );
    let mut results = Vec::with_capacity(count);

    for _ in 0..count {
        let hash = cursor.bytes(16)?.to_vec();
        let _client_id = cursor.u32()?;
        let _client_port = cursor.u16()?;
        let tag_count = cursor.u32()? as usize;

        if tag_count > MAX_TAGS_PER_RECORD {
            return Err(format!(
                "ED2K search result has too many tags: {tag_count}."
            ));
        }

        let mut name = None;
        let mut size_low = 0u64;
        let mut size_high = 0u64;
        let mut sources = 0u64;
        let mut complete_sources = 0u64;

        for _ in 0..tag_count {
            let tag = read_tag(&mut cursor)?;
            match tag.name_id {
                Some(FT_FILENAME) => {
                    if let Some(value) = tag_string(&tag) {
                        name = Some(value.to_string());
                    }
                }
                Some(FT_FILESIZE) => {
                    size_low = tag_integer(&tag).unwrap_or(0);
                }
                Some(FT_FILESIZE_HI) => {
                    size_high = tag_integer(&tag).unwrap_or(0);
                }
                Some(FT_SOURCES) => {
                    sources = tag_integer(&tag).unwrap_or(0);
                }
                Some(FT_COMPLETE_SOURCES) => {
                    complete_sources = tag_integer(&tag).unwrap_or(0);
                }
                _ => {}
            }
        }

        let Some(name) = name.filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let size = size_low.saturating_add(size_high << 32);
        if size == 0 {
            continue;
        }

        let hash = hash_hex(&hash);
        let encoded_name = urlencoding::encode(&name);
        let ed2k_link = format!(
            "ed2k://|file|{encoded_name}|{size}|{hash}|/"
        );

        results.push(NativeEd2kSearchResult {
            hash,
            book_candidate: is_book_candidate(&name),
            name,
            size,
            sources,
            complete_sources,
            ed2k_link,
            servers: vec![server_label.clone()],
        });
    }

    Ok(results)
}

async fn await_login(stream: &mut TcpStream) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(7);

    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err("ED2K server login timed out.".to_string());
        }

        let remaining = deadline - now;
        let packet = timeout(remaining, read_packet(stream))
            .await
            .map_err(|_| "ED2K server login timed out.".to_string())??;

        match packet.opcode {
            OP_IDCHANGE => return Ok(()),
            OP_REJECT => {
                return Err("ED2K server rejected the login request.".to_string())
            }
            _ => {
                // Server identity, status and informational message packets
                // may arrive before OP_IDCHANGE and are intentionally ignored.
            }
        }
    }
}

async fn search_one_server(
    server: NativeEd2kServer,
    query: String,
) -> Result<Vec<NativeEd2kSearchResult>, String> {
    let endpoint = format!("{}:{}", server.address, server.port);
    let mut stream = timeout(
        Duration::from_secs(5),
        TcpStream::connect(&endpoint),
    )
    .await
    .map_err(|_| format!("Connection to {endpoint} timed out."))?
    .map_err(|error| format!("Unable to connect to {endpoint}: {error}"))?;

    let login = encode_packet(OP_LOGINREQUEST, &login_payload()?)?;
    timeout(Duration::from_secs(3), stream.write_all(&login))
        .await
        .map_err(|_| format!("Login write to {endpoint} timed out."))?
        .map_err(|error| format!("Unable to send login to {endpoint}: {error}"))?;

    await_login(&mut stream).await?;

    let request = encode_packet(OP_SEARCHREQUEST, &search_payload(&query)?)?;
    timeout(Duration::from_secs(3), stream.write_all(&request))
        .await
        .map_err(|_| format!("Search write to {endpoint} timed out."))?
        .map_err(|error| format!("Unable to send search to {endpoint}: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(9);
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(format!(
                "Search response from {endpoint} timed out."
            ));
        }

        let remaining = deadline - now;
        let packet = timeout(remaining, read_packet(&mut stream))
            .await
            .map_err(|_| {
                format!("Search response from {endpoint} timed out.")
            })??;

        if packet.opcode == OP_SEARCHRESULT {
            return parse_search_results(&packet.payload, &server);
        }

        if packet.opcode == OP_REJECT {
            return Err(format!(
                "ED2K server {endpoint} rejected the search."
            ));
        }
    }
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("resource-ed2k-native").join("server.met"))
        .map_err(|error| {
            format!("Unable to resolve ED2K cache directory: {error}")
        })
}

async fn read_cache_if_fresh(path: &PathBuf) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).await.ok()?;
    let modified = metadata.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age.as_secs() > SERVER_MET_CACHE_SECONDS {
        return None;
    }

    fs::read(path).await.ok()
}

async fn load_server_met(app: &AppHandle) -> Result<(Vec<u8>, String), String> {
    let path = cache_path(app)?;

    if let Some(cached) = read_cache_if_fresh(&path).await {
        return Ok((cached, "cache".to_string()));
    }

    let download = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| format!("Unable to create ED2K HTTP client: {error}"))?;

        let response = client
            .get(SERVER_MET_URL)
            .send()
            .await
            .map_err(|error| format!("Unable to download server.met: {error}"))?
            .error_for_status()
            .map_err(|error| format!("server.met download failed: {error}"))?;

        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Unable to read server.met: {error}"))?
            .to_vec();

        parse_server_met(&bytes)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| {
                    format!("Unable to create ED2K cache directory: {error}")
                })?;
        }
        fs::write(&path, &bytes)
            .await
            .map_err(|error| format!("Unable to cache server.met: {error}"))?;

        Ok::<Vec<u8>, String>(bytes)
    }
    .await;

    match download {
        Ok(bytes) => Ok((bytes, "network".to_string())),
        Err(download_error) => {
            if let Ok(bytes) = fs::read(&path).await {
                parse_server_met(&bytes)?;
                Ok((bytes, "stale-cache".to_string()))
            } else {
                Err(download_error)
            }
        }
    }
}

fn merge_results(
    batches: Vec<Vec<NativeEd2kSearchResult>>,
) -> Vec<NativeEd2kSearchResult> {
    let mut merged: HashMap<String, NativeEd2kSearchResult> = HashMap::new();

    for batch in batches {
        for result in batch {
            let key = format!("{}:{}", result.hash, result.size);
            if let Some(existing) = merged.get_mut(&key) {
                existing.sources = existing.sources.max(result.sources);
                existing.complete_sources =
                    existing.complete_sources.max(result.complete_sources);
                for server in result.servers {
                    if !existing.servers.contains(&server) {
                        existing.servers.push(server);
                    }
                }
            } else {
                merged.insert(key, result);
            }
        }
    }

    let mut results = merged.into_values().collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .book_candidate
            .cmp(&left.book_candidate)
            .then_with(|| right.sources.cmp(&left.sources))
            .then_with(|| right.complete_sources.cmp(&left.complete_sources))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    results
}

#[tauri::command]
pub async fn resource_ed2k_native_search(
    app: AppHandle,
    query: String,
    max_servers: Option<usize>,
) -> Result<NativeEd2kSearchResponse, String> {
    let query = query.trim().to_string();
    let _ = search_payload(&query)?;

    let (server_met, server_list_source) = load_server_met(&app).await?;
    let servers = parse_server_met(&server_met)?;
    if servers.is_empty() {
        return Err("server.met contains no usable ED2K servers.".to_string());
    }

    let server_limit = max_servers
        .unwrap_or(DEFAULT_QUERY_SERVERS)
        .clamp(1, MAX_QUERY_SERVERS);
    let selected = servers
        .iter()
        .filter(|server| server.failed_count < 10)
        .take(server_limit)
        .cloned()
        .collect::<Vec<_>>();

    if selected.is_empty() {
        return Err("No usable ED2K servers are available.".to_string());
    }

    let servers_queried = selected.len();
    let tasks = selected
        .into_iter()
        .map(|server| search_one_server(server, query.clone()));

    let responses = join_all(tasks).await;
    let mut successful = Vec::new();
    let mut errors = Vec::new();

    for response in responses {
        match response {
            Ok(results) => successful.push(results),
            Err(error) => errors.push(error),
        }
    }

    let servers_succeeded = successful.len();
    if servers_succeeded == 0 {
        return Err(format!(
            "Native ED2K search could not reach any server. {}",
            errors.join(" | ")
        ));
    }

    Ok(NativeEd2kSearchResponse {
        query,
        server_list_source,
        servers_loaded: servers.len(),
        servers_queried,
        servers_succeeded,
        results: merge_results(successful),
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn old_string_tag(name_id: u8, value: &str) -> Vec<u8> {
        let mut data = Vec::new();
        push_old_string_tag(&mut data, name_id, value).unwrap();
        data
    }

    fn old_u32_tag(name_id: u8, value: u32) -> Vec<u8> {
        let mut data = Vec::new();
        push_old_u32_tag(&mut data, name_id, value);
        data
    }

    #[test]
    fn encodes_ed2k_tcp_frame() {
        let packet = encode_packet(OP_SEARCHREQUEST, &[1, 2, 3]).unwrap();
        assert_eq!(packet[0], OP_EDONKEYPROT);
        assert_eq!(&packet[1..5], &4u32.to_le_bytes());
        assert_eq!(packet[5], OP_SEARCHREQUEST);
        assert_eq!(&packet[6..], &[1, 2, 3]);
    }

    #[test]
    fn encodes_plain_word_search_as_prefix_and_tree() {
        let payload = search_payload("history science").unwrap();
        assert_eq!(&payload[..2], &[0, 0]);

        let mut cursor = ByteCursor::new(&payload[2..]);
        assert_eq!(cursor.u8().unwrap(), 1);
        assert_eq!(cursor.string_u16().unwrap(), "history");
        assert_eq!(cursor.u8().unwrap(), 1);
        assert_eq!(cursor.string_u16().unwrap(), "science");
        assert_eq!(cursor.remaining(), 0);
    }

    #[test]
    fn parses_minimal_server_met() {
        let mut data = vec![0xE0];
        push_u32(&mut data, 1);
        push_u32(
            &mut data,
            u32::from_le_bytes([45, 82, 80, 155]),
        );
        push_u16(&mut data, 5687);
        push_u32(&mut data, 1);
        data.extend_from_slice(&old_string_tag(
            ST_SERVERNAME,
            "Example ED2K",
        ));

        let servers = parse_server_met(&data).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].address, "45.82.80.155");
        assert_eq!(servers[0].port, 5687);
        assert_eq!(servers[0].name.as_deref(), Some("Example ED2K"));
    }

    #[test]
    fn parses_server_search_result_tags() {
        let mut payload = Vec::new();
        push_u32(&mut payload, 1);
        payload.extend_from_slice(&[0x11; 16]);
        push_u32(&mut payload, 0);
        push_u16(&mut payload, 0);
        push_u32(&mut payload, 3);
        payload.extend_from_slice(&old_string_tag(
            FT_FILENAME,
            "Example Book.epub",
        ));
        payload.extend_from_slice(&old_u32_tag(
            FT_FILESIZE,
            12_345,
        ));
        payload.extend_from_slice(&old_u32_tag(
            FT_SOURCES,
            7,
        ));

        let server = NativeEd2kServer {
            address: "1.2.3.4".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
        };

        let results = parse_search_results(&payload, &server).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Example Book.epub");
        assert_eq!(results[0].size, 12_345);
        assert_eq!(results[0].sources, 7);
        assert!(results[0].book_candidate);
        assert_eq!(
            results[0].hash,
            "11111111111111111111111111111111"
        );
        assert!(results[0].ed2k_link.starts_with("ed2k://|file|"));
    }

    #[test]
    fn merges_duplicate_hashes_across_servers() {
        let first = NativeEd2kSearchResult {
            hash: "aa".repeat(16),
            name: "book.pdf".to_string(),
            size: 100,
            sources: 4,
            complete_sources: 1,
            book_candidate: true,
            ed2k_link: "ed2k://test".to_string(),
            servers: vec!["one:1".to_string()],
        };
        let mut second = first.clone();
        second.sources = 9;
        second.servers = vec!["two:2".to_string()];

        let merged = merge_results(vec![vec![first], vec![second]]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].sources, 9);
        assert_eq!(merged[0].servers.len(), 2);
    }
}

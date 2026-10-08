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
    net::{TcpStream, UdpSocket},
    time::{timeout, Instant},
};

const SERVER_MET_URL: &str = "https://upd.emule-security.org/server.met";
const SERVER_MET_CACHE_SECONDS: u64 = 6 * 60 * 60;
const DEFAULT_QUERY_SERVERS: usize = 4;
const MAX_QUERY_SERVERS: usize = 10;
const DEFAULT_GLOBAL_SERVERS: usize = 24;
const MAX_GLOBAL_SERVERS: usize = 48;
const GLOBAL_UDP_TIMEOUT: Duration = Duration::from_millis(2800);
const GLOBAL_UDP_IDLE_AFTER_RESPONSE: Duration = Duration::from_millis(450);
const MAX_UDP_DATAGRAM_SIZE: usize = 65_507;
const MAX_SERVER_COUNT: usize = 10_000;
const MAX_PACKET_SIZE: usize = 8 * 1024 * 1024;
const MAX_RESULTS_PER_PACKET: usize = 20_000;
const MAX_TAGS_PER_RECORD: usize = 512;

const OP_EDONKEYPROT: u8 = 0xE3;
const OP_PACKEDPROT: u8 = 0xD4;
const OP_LOGINREQUEST: u8 = 0x01;
const OP_REJECT: u8 = 0x05;
const OP_SEARCHREQUEST: u8 = 0x16;
const OP_GETSOURCES: u8 = 0x19;
const OP_SEARCHRESULT: u8 = 0x33;
const OP_IDCHANGE: u8 = 0x40;
const OP_FOUNDSOURCES: u8 = 0x42;
const OP_GLOBSEARCHREQ2: u8 = 0x92;
const OP_GLOBSEARCHREQ: u8 = 0x98;
const OP_GLOBSEARCHRES: u8 = 0x99;

const SRV_UDPFLG_EXT_GETFILES: u64 = 0x0000_0002;
const SRV_TCPFLG_LARGEFILES: u32 = 0x0000_0100;

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
const ST_UDPFLAGS: u8 = 0x92;

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
    pub udp_flags: u64,
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
    pub tcp_servers_queried: usize,
    pub tcp_servers_succeeded: usize,
    pub global_servers_queried: usize,
    pub global_servers_responded: usize,
    pub kad_nodes_source: Option<String>,
    pub kad_contacts_loaded: usize,
    pub kad_contacts_discovered: usize,
    pub kad_bootstrap_queried: usize,
    pub kad_bootstrap_responded: usize,
    pub kad_lookup_queried: usize,
    pub kad_lookup_responded: usize,
    pub kad_keyword_queried: usize,
    pub kad_keyword_responded: usize,
    pub search_phase: String,
    pub results: Vec<NativeEd2kSearchResult>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeEd2kSource {
    pub address: Option<String>,
    pub tcp_port: u16,
    pub udp_port: Option<u16>,
    pub origin: String,
    pub direct: bool,
    pub low_id: bool,
    pub client_id: Option<u32>,
    pub source_id: Option<String>,
    pub server: Option<String>,
    pub buddy_address: Option<String>,
    pub buddy_port: Option<u16>,
    pub buddy_id: Option<String>,
    pub source_type: Option<u8>,
    pub encryption: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEd2kSourceDiscoveryResponse {
    pub hash: String,
    pub size: u64,
    pub server_list_source: String,
    pub servers_loaded: usize,
    pub servers_queried: usize,
    pub servers_responded: usize,
    pub kad_nodes_source: Option<String>,
    pub kad_contacts_loaded: usize,
    pub kad_contacts_discovered: usize,
    pub kad_bootstrap_queried: usize,
    pub kad_bootstrap_responded: usize,
    pub kad_lookup_queried: usize,
    pub kad_lookup_responded: usize,
    pub kad_source_queried: usize,
    pub kad_source_responded: usize,
    pub search_phase: String,
    pub sources: Vec<NativeEd2kSource>,
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
    match &tag.value {
        TagValue::Integer(value) => Some(*value),
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
        let mut udp_flags = 0;

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
                Some(ST_UDPFLAGS) => {
                    udp_flags = tag_integer(&tag).unwrap_or(0);
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
            udp_flags,
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

fn push_u64(buffer: &mut Vec<u8>, value: u64) {
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

fn parse_search_result(
    cursor: &mut ByteCursor<'_>,
    server: &NativeEd2kServer,
) -> Result<Option<NativeEd2kSearchResult>, String> {
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
        let tag = read_tag(cursor)?;
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
        return Ok(None);
    };
    let size = size_low.saturating_add(size_high << 32);
    if size == 0 {
        return Ok(None);
    }

    let hash = hash_hex(&hash);
    let encoded_name = urlencoding::encode(&name);
    let ed2k_link = format!(
        "ed2k://|file|{encoded_name}|{size}|{hash}|/"
    );
    let server_label = format!("{}:{}", server.address, server.port);

    Ok(Some(NativeEd2kSearchResult {
        hash,
        book_candidate: is_book_candidate(&name),
        name,
        size,
        sources,
        complete_sources,
        ed2k_link,
        servers: vec![server_label],
    }))
}

fn parse_ed2k_hash(value: &str) -> Result<[u8; 16], String> {
    let value = value.trim();
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("ED2K hash must contain exactly 32 hexadecimal characters.".to_string());
    }

    let mut hash = [0u8; 16];
    for (index, slot) in hash.iter_mut().enumerate() {
        let offset = index * 2;
        *slot = u8::from_str_radix(&value[offset..offset + 2], 16)
            .map_err(|_| "ED2K hash contains invalid hexadecimal data.".to_string())?;
    }
    Ok(hash)
}

fn valid_remote_source_address(address: Ipv4Addr) -> bool {
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_private()
        && !address.is_link_local()
        && !address.is_documentation()
        && !address.is_multicast()
        && !address.is_broadcast()
}

fn parse_found_sources(
    payload: &[u8],
    expected_hash: &[u8; 16],
    server: &NativeEd2kServer,
) -> Result<Vec<NativeEd2kSource>, String> {
    let mut cursor = ByteCursor::new(payload);
    let returned_hash = cursor.bytes(16)?;
    if returned_hash != expected_hash {
        return Err("ED2K source response hash does not match the requested file.".to_string());
    }

    let count = cursor.u8()? as usize;
    let required = count
        .checked_mul(6)
        .ok_or_else(|| "ED2K source response size overflow.".to_string())?;
    if cursor.remaining() < required {
        return Err(format!(
            "ED2K source response is truncated: expected {required} source bytes, got {}.",
            cursor.remaining()
        ));
    }

    let server_label = format!("{}:{}", server.address, server.port);
    let mut sources = Vec::with_capacity(count);
    for _ in 0..count {
        let client_id = cursor.u32()?;
        let tcp_port = cursor.u16()?;
        if tcp_port == 0 {
            continue;
        }

        let low_id = client_id < 0x0100_0000;
        if low_id {
            sources.push(NativeEd2kSource {
                address: None,
                tcp_port,
                udp_port: None,
                origin: "server-tcp".to_string(),
                direct: false,
                low_id: true,
                client_id: Some(client_id),
                source_id: None,
                server: Some(server_label.clone()),
                buddy_address: None,
                buddy_port: None,
                buddy_id: None,
                source_type: None,
                encryption: None,
            });
            continue;
        }

        let address = Ipv4Addr::from(client_id.to_le_bytes());
        if !valid_remote_source_address(address) {
            continue;
        }

        sources.push(NativeEd2kSource {
            address: Some(address.to_string()),
            tcp_port,
            udp_port: None,
            origin: "server-tcp".to_string(),
            direct: true,
            low_id: false,
            client_id: Some(client_id),
            source_id: None,
            server: Some(server_label.clone()),
            buddy_address: None,
            buddy_port: None,
            buddy_id: None,
            source_type: None,
            encryption: None,
        });
    }

    Ok(sources)
}

fn source_identity(source: &NativeEd2kSource) -> String {
    if let Some(address) = source.address.as_deref() {
        return format!("direct:{address}:{}", source.tcp_port);
    }
    if let Some(source_id) = source.source_id.as_deref() {
        return format!("kad-id:{source_id}");
    }

    format!(
        "low:{}:{}:{}",
        source.server.as_deref().unwrap_or_default(),
        source.client_id.unwrap_or(0),
        source.tcp_port
    )
}

fn merge_sources(
    batches: Vec<Vec<NativeEd2kSource>>,
) -> Vec<NativeEd2kSource> {
    let mut merged: HashMap<String, NativeEd2kSource> = HashMap::new();

    for batch in batches {
        for source in batch {
            let key = source_identity(&source);
            if let Some(existing) = merged.get_mut(&key) {
                if existing.origin != source.origin
                    && !existing.origin.split('+').any(|part| part == source.origin)
                {
                    existing.origin = format!("{}+{}", existing.origin, source.origin);
                }
                if existing.udp_port.is_none() {
                    existing.udp_port = source.udp_port;
                }
                if existing.client_id.is_none() {
                    existing.client_id = source.client_id;
                }
                if existing.source_id.is_none() {
                    existing.source_id = source.source_id;
                }
                if existing.server.is_none() {
                    existing.server = source.server;
                }
                if existing.buddy_address.is_none() {
                    existing.buddy_address = source.buddy_address;
                }
                if existing.buddy_port.is_none() {
                    existing.buddy_port = source.buddy_port;
                }
                if existing.buddy_id.is_none() {
                    existing.buddy_id = source.buddy_id;
                }
                if existing.source_type.is_none() {
                    existing.source_type = source.source_type;
                }
                if existing.encryption.is_none() {
                    existing.encryption = source.encryption;
                }
                existing.direct |= source.direct;
                existing.low_id &= source.low_id;
            } else {
                merged.insert(key, source);
            }
        }
    }

    let mut sources = merged.into_values().collect::<Vec<_>>();
    sources.sort_by(|left, right| {
        right
            .direct
            .cmp(&left.direct)
            .then_with(|| left.low_id.cmp(&right.low_id))
            .then_with(|| left.address.cmp(&right.address))
            .then_with(|| left.tcp_port.cmp(&right.tcp_port))
    });
    sources
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

    let mut results = Vec::with_capacity(count);
    for _ in 0..count {
        if let Some(result) = parse_search_result(&mut cursor, server)? {
            results.push(result);
        }
    }

    Ok(results)
}

fn encode_udp_search_packet(
    server: &NativeEd2kServer,
    query: &str,
) -> Result<Vec<u8>, String> {
    let opcode = if server.udp_flags & SRV_UDPFLG_EXT_GETFILES != 0 {
        OP_GLOBSEARCHREQ2
    } else {
        OP_GLOBSEARCHREQ
    };
    let payload = search_payload(query)?;
    let mut packet = Vec::with_capacity(payload.len() + 2);
    packet.push(OP_EDONKEYPROT);
    packet.push(opcode);
    packet.extend_from_slice(&payload);
    Ok(packet)
}

fn parse_udp_search_datagram(
    datagram: &[u8],
    server: &NativeEd2kServer,
) -> Result<Vec<NativeEd2kSearchResult>, String> {
    if datagram.len() < 2 {
        return Err("ED2K UDP search datagram is too short.".to_string());
    }

    let mut cursor = ByteCursor::new(datagram);
    let mut results = Vec::new();

    while cursor.remaining() >= 2 {
        let protocol = cursor.u8()?;
        let opcode = cursor.u8()?;
        if protocol != OP_EDONKEYPROT || opcode != OP_GLOBSEARCHRES {
            return Err(format!(
                "Unexpected ED2K UDP search header 0x{protocol:02x}/0x{opcode:02x}."
            ));
        }

        if let Some(result) = parse_search_result(&mut cursor, server)? {
            results.push(result);
        }

        if results.len() > MAX_RESULTS_PER_PACKET {
            return Err(
                "ED2K UDP datagram contains too many search results."
                    .to_string(),
            );
        }
    }

    if cursor.remaining() != 0 {
        return Err("ED2K UDP search datagram has trailing bytes.".to_string());
    }

    Ok(results)
}

async fn await_login(stream: &mut TcpStream) -> Result<u32, String> {
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
            OP_IDCHANGE => {
                if packet.payload.len() < 4 {
                    return Err(
                        "ED2K server returned a truncated IDCHANGE packet."
                            .to_string(),
                    );
                }
                let mut cursor = ByteCursor::new(&packet.payload);
                let client_id = cursor.u32()?;
                if client_id == 0 {
                    return Err(
                        "ED2K server rejected the login (no client ID assigned)."
                            .to_string(),
                    );
                }
                let tcp_flags = if cursor.remaining() >= 4 {
                    cursor.u32()?
                } else {
                    0
                };
                return Ok(tcp_flags);
            }
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

    let _tcp_flags = await_login(&mut stream).await?;

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

fn source_request_payload(
    hash: &[u8; 16],
    size: u64,
    tcp_flags: u32,
) -> Result<Vec<u8>, String> {
    let mut payload = Vec::with_capacity(
        16 + if size > u32::MAX as u64 { 12 } else { 4 },
    );
    payload.extend_from_slice(hash);

    if size > u32::MAX as u64 {
        if tcp_flags & SRV_TCPFLG_LARGEFILES == 0 {
            return Err(
                "ED2K server does not advertise large-file source lookup support."
                    .to_string(),
            );
        }
        push_u32(&mut payload, 0);
        push_u64(&mut payload, size);
    } else {
        push_u32(&mut payload, size as u32);
    }

    Ok(payload)
}

async fn discover_sources_one_server(
    server: NativeEd2kServer,
    hash: [u8; 16],
    size: u64,
) -> Result<Vec<NativeEd2kSource>, String> {
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

    let tcp_flags = await_login(&mut stream).await?;

    let payload = source_request_payload(&hash, size, tcp_flags)?;
    let request = encode_packet(OP_GETSOURCES, &payload)?;
    timeout(Duration::from_secs(3), stream.write_all(&request))
        .await
        .map_err(|_| format!("Source request write to {endpoint} timed out."))?
        .map_err(|error| {
            format!("Unable to send source request to {endpoint}: {error}")
        })?;

    let deadline = Instant::now() + Duration::from_secs(9);
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(format!(
                "Source response from {endpoint} timed out."
            ));
        }

        let remaining = deadline - now;
        let packet = timeout(remaining, read_packet(&mut stream))
            .await
            .map_err(|_| {
                format!("Source response from {endpoint} timed out.")
            })??;

        if packet.opcode == OP_FOUNDSOURCES {
            return parse_found_sources(&packet.payload, &hash, &server);
        }

        if packet.opcode == OP_REJECT {
            return Err(format!(
                "ED2K server {endpoint} rejected the source lookup."
            ));
        }
    }
}

async fn search_one_global_server(
    server: NativeEd2kServer,
    query: String,
) -> Result<Vec<NativeEd2kSearchResult>, String> {
    let udp_port = server
        .port
        .checked_add(4)
        .ok_or_else(|| {
            format!(
                "ED2K server {}:{} has no valid UDP port.",
                server.address, server.port
            )
        })?;
    let endpoint = format!("{}:{udp_port}", server.address);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|error| format!("Unable to bind ED2K UDP socket: {error}"))?;
    socket
        .connect(&endpoint)
        .await
        .map_err(|error| format!("Unable to connect UDP to {endpoint}: {error}"))?;

    let request = encode_udp_search_packet(&server, &query)?;
    socket
        .send(&request)
        .await
        .map_err(|error| {
            format!("Unable to send ED2K global search to {endpoint}: {error}")
        })?;

    let deadline = Instant::now() + GLOBAL_UDP_TIMEOUT;
    let mut received_any = false;
    let mut results = Vec::new();
    let mut buffer = vec![0u8; MAX_UDP_DATAGRAM_SIZE];

    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }

        let remaining = deadline - now;
        let wait = if received_any {
            remaining.min(GLOBAL_UDP_IDLE_AFTER_RESPONSE)
        } else {
            remaining
        };

        match timeout(wait, socket.recv(&mut buffer)).await {
            Ok(Ok(length)) => {
                received_any = true;
                if length == 0 {
                    continue;
                }
                let mut parsed =
                    parse_udp_search_datagram(&buffer[..length], &server)?;
                results.append(&mut parsed);
            }
            Ok(Err(error)) => {
                return Err(format!(
                    "Unable to receive ED2K global search response from {endpoint}: {error}"
                ));
            }
            Err(_) => break,
        }
    }

    if received_any {
        Ok(results)
    } else {
        Err(format!(
            "No UDP global-search response from {}:{}.",
            server.address, udp_port
        ))
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
pub async fn resource_ed2k_native_discover_sources(
    app: AppHandle,
    hash: String,
    size: u64,
    max_servers: Option<usize>,
) -> Result<NativeEd2kSourceDiscoveryResponse, String> {
    if size == 0 {
        return Err("ED2K source discovery requires a non-zero file size.".to_string());
    }
    let hash_bytes = parse_ed2k_hash(&hash)?;
    let normalized_hash = hash_hex(&hash_bytes);

    let mut errors = Vec::new();
    let (servers, server_list_source) = match load_server_met(&app).await {
        Ok((server_met, source)) => match parse_server_met(&server_met) {
            Ok(servers) => (servers, source),
            Err(error) => {
                errors.push("Server list: ".to_string() + &error);
                (Vec::new(), "unavailable".to_string())
            }
        },
        Err(error) => {
            errors.push("Server list: ".to_string() + &error);
            (Vec::new(), "unavailable".to_string())
        }
    };

    let limit = max_servers
        .unwrap_or(DEFAULT_QUERY_SERVERS.saturating_add(2))
        .clamp(1, MAX_QUERY_SERVERS);
    let selected = servers
        .iter()
        .filter(|server| server.failed_count < 10)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    let servers_queried = selected.len();
    let server_hash = hash_bytes;
    let tasks = selected
        .into_iter()
        .map(|server| discover_sources_one_server(server, server_hash, size));

    let app_for_kad = app.clone();
    let (responses, kad_response) = tokio::join!(
        join_all(tasks),
        super::ed2k_kad::discover_sources_kad(
            &app_for_kad,
            &hash_bytes,
            size,
        ),
    );

    let mut batches = Vec::new();
    let mut servers_responded = 0usize;
    for response in responses {
        match response {
            Ok(sources) => {
                servers_responded += 1;
                if !sources.is_empty() {
                    batches.push(sources);
                }
            }
            Err(error) => errors.push("TCP source lookup: ".to_string() + &error),
        }
    }

    let mut kad_nodes_source = None;
    let mut kad_contacts_loaded = 0usize;
    let mut kad_contacts_discovered = 0usize;
    let mut kad_bootstrap_queried = 0usize;
    let mut kad_bootstrap_responded = 0usize;
    let mut kad_lookup_queried = 0usize;
    let mut kad_lookup_responded = 0usize;
    let mut kad_source_queried = 0usize;
    let mut kad_source_responded = 0usize;

    match kad_response {
        Ok(outcome) => {
            kad_nodes_source = Some(outcome.nodes_source);
            kad_contacts_loaded = outcome.contacts_loaded;
            kad_contacts_discovered = outcome.contacts_discovered;
            kad_bootstrap_queried = outcome.bootstrap_queried;
            kad_bootstrap_responded = outcome.bootstrap_responded;
            kad_lookup_queried = outcome.lookup_queried;
            kad_lookup_responded = outcome.lookup_responded;
            kad_source_queried = outcome.source_queried;
            kad_source_responded = outcome.source_responded;
            if !outcome.sources.is_empty() {
                batches.push(outcome.sources);
            }
            errors.extend(
                outcome
                    .errors
                    .into_iter()
                    .map(|error| "KAD source lookup: ".to_string() + &error),
            );
        }
        Err(error) => {
            errors.push("KAD source lookup: ".to_string() + &error);
        }
    }

    if errors.len() > 64 {
        errors.truncate(64);
        errors.push(
            "Additional ED2K/Kad source lookup errors were suppressed.".to_string(),
        );
    }

    Ok(NativeEd2kSourceDiscoveryResponse {
        hash: normalized_hash,
        size,
        server_list_source,
        servers_loaded: servers.len(),
        servers_queried,
        servers_responded,
        kad_nodes_source,
        kad_contacts_loaded,
        kad_contacts_discovered,
        kad_bootstrap_queried,
        kad_bootstrap_responded,
        kad_lookup_queried,
        kad_lookup_responded,
        kad_source_queried,
        kad_source_responded,
        search_phase: "server+kad-source-lookup".to_string(),
        sources: merge_sources(batches),
        errors,
    })
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

    let tcp_limit = max_servers
        .unwrap_or(DEFAULT_QUERY_SERVERS)
        .clamp(1, MAX_QUERY_SERVERS);
    let tcp_selected = servers
        .iter()
        .filter(|server| server.failed_count < 10)
        .take(tcp_limit)
        .cloned()
        .collect::<Vec<_>>();

    if tcp_selected.is_empty() {
        return Err("No usable ED2K servers are available.".to_string());
    }

    let tcp_keys = tcp_selected
        .iter()
        .map(|server| format!("{}:{}", server.address, server.port))
        .collect::<std::collections::HashSet<_>>();

    let global_limit = DEFAULT_GLOBAL_SERVERS.min(MAX_GLOBAL_SERVERS);
    let global_selected = servers
        .iter()
        .filter(|server| {
            server.failed_count < 10
                && server.port <= u16::MAX - 4
                && !tcp_keys.contains(&format!(
                    "{}:{}",
                    server.address, server.port
                ))
        })
        .take(global_limit)
        .cloned()
        .collect::<Vec<_>>();

    let tcp_servers_queried = tcp_selected.len();
    let global_servers_queried = global_selected.len();

    let tcp_tasks = tcp_selected
        .into_iter()
        .map(|server| search_one_server(server, query.clone()));
    let global_tasks = global_selected
        .into_iter()
        .map(|server| search_one_global_server(server, query.clone()));

    let app_for_kad = app.clone();
    let kad_query = query.clone();
    let (tcp_responses, global_responses, kad_response) = tokio::join!(
        join_all(tcp_tasks),
        join_all(global_tasks),
        super::ed2k_kad::search_kad(&app_for_kad, &kad_query),
    );

    let mut batches = Vec::new();
    let mut errors = Vec::new();
    let mut tcp_servers_succeeded = 0usize;
    let mut global_servers_responded = 0usize;

    let mut kad_nodes_source = None;
    let mut kad_contacts_loaded = 0usize;
    let mut kad_contacts_discovered = 0usize;
    let mut kad_bootstrap_queried = 0usize;
    let mut kad_bootstrap_responded = 0usize;
    let mut kad_lookup_queried = 0usize;
    let mut kad_lookup_responded = 0usize;
    let mut kad_keyword_queried = 0usize;
    let mut kad_keyword_responded = 0usize;

    for response in tcp_responses {
        match response {
            Ok(results) => {
                tcp_servers_succeeded += 1;
                batches.push(results);
            }
            Err(error) => errors.push("TCP: ".to_string() + &error),
        }
    }

    for response in global_responses {
        match response {
            Ok(results) => {
                global_servers_responded += 1;
                batches.push(results);
            }
            Err(error) => errors.push("UDP: ".to_string() + &error),
        }
    }

    match kad_response {
        Ok(outcome) => {
            kad_nodes_source = Some(outcome.nodes_source);
            kad_contacts_loaded = outcome.contacts_loaded;
            kad_contacts_discovered = outcome.contacts_discovered;
            kad_bootstrap_queried = outcome.bootstrap_queried;
            kad_bootstrap_responded = outcome.bootstrap_responded;
            kad_lookup_queried = outcome.lookup_queried;
            kad_lookup_responded = outcome.lookup_responded;
            kad_keyword_queried = outcome.keyword_queried;
            kad_keyword_responded = outcome.keyword_responded;
            if !outcome.results.is_empty() {
                batches.push(outcome.results);
            }
            errors.extend(
                outcome
                    .errors
                    .into_iter()
                    .map(|error| "KAD: ".to_string() + &error),
            );
        }
        Err(error) => errors.push("KAD: ".to_string() + &error),
    }

    let servers_queried =
        tcp_servers_queried.saturating_add(global_servers_queried);
    let servers_succeeded =
        tcp_servers_succeeded.saturating_add(global_servers_responded);

    let kad_network_responded = kad_bootstrap_responded
        .saturating_add(kad_lookup_responded)
        .saturating_add(kad_keyword_responded)
        > 0;

    if servers_succeeded == 0 && !kad_network_responded {
        return Err(format!(
            "Native ED2K/Kad search could not reach any network peer. {}",
            errors.join(" | ")
        ));
    }

    if errors.len() > 64 {
        errors.truncate(64);
        errors.push(
            "Additional ED2K/Kad timeout errors were suppressed.".to_string(),
        );
    }

    Ok(NativeEd2kSearchResponse {
        query,
        server_list_source,
        servers_loaded: servers.len(),
        servers_queried,
        servers_succeeded,
        tcp_servers_queried,
        tcp_servers_succeeded,
        global_servers_queried,
        global_servers_responded,
        kad_nodes_source,
        kad_contacts_loaded,
        kad_contacts_discovered,
        kad_bootstrap_queried,
        kad_bootstrap_responded,
        kad_lookup_queried,
        kad_lookup_responded,
        kad_keyword_queried,
        kad_keyword_responded,
        search_phase: "tcp-seed+udp-global+kad-keyword".to_string(),
        results: merge_results(batches),
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
        push_u32(&mut data, 2);
        data.extend_from_slice(&old_string_tag(
            ST_SERVERNAME,
            "Example ED2K",
        ));
        data.extend_from_slice(&old_u32_tag(
            ST_UDPFLAGS,
            SRV_UDPFLG_EXT_GETFILES as u32,
        ));

        let servers = parse_server_met(&data).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].address, "45.82.80.155");
        assert_eq!(servers[0].port, 5687);
        assert_eq!(servers[0].name.as_deref(), Some("Example ED2K"));
        assert_eq!(
            servers[0].udp_flags & SRV_UDPFLG_EXT_GETFILES,
            SRV_UDPFLG_EXT_GETFILES,
        );
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
            udp_flags: SRV_UDPFLG_EXT_GETFILES,
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
    fn encodes_regular_server_source_request_with_u32_size() {
        let hash = [0xA1; 16];
        let payload =
            source_request_payload(&hash, 12_345, 0).unwrap();
        assert_eq!(payload.len(), 20);
        assert_eq!(&payload[..16], &hash);
        assert_eq!(&payload[16..20], &12_345u32.to_le_bytes());
    }

    #[test]
    fn encodes_large_server_source_request_when_supported() {
        let hash = [0xB2; 16];
        let size = (u32::MAX as u64) + 123;
        let payload = source_request_payload(
            &hash,
            size,
            SRV_TCPFLG_LARGEFILES,
        )
        .unwrap();
        assert_eq!(payload.len(), 28);
        assert_eq!(&payload[..16], &hash);
        assert_eq!(&payload[16..20], &0u32.to_le_bytes());
        assert_eq!(&payload[20..28], &size.to_le_bytes());
    }

    #[test]
    fn rejects_large_server_source_request_without_capability() {
        let hash = [0xC3; 16];
        let size = (u32::MAX as u64) + 1;
        assert!(source_request_payload(&hash, size, 0).is_err());
    }

    #[test]
    fn parses_ed2k_server_found_sources() {
        let hash = [0xAB; 16];
        let server = NativeEd2kServer {
            address: "5.6.7.8".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
            udp_flags: 0,
        };
        let mut payload = Vec::new();
        payload.extend_from_slice(&hash);
        payload.push(2);

        let high_id = u32::from_le_bytes([8, 8, 4, 4]);
        push_u32(&mut payload, high_id);
        push_u16(&mut payload, 4662);

        push_u32(&mut payload, 12_345);
        push_u16(&mut payload, 4663);

        let sources = parse_found_sources(&payload, &hash, &server).unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].address.as_deref(), Some("8.8.4.4"));
        assert!(sources[0].direct);
        assert!(!sources[0].low_id);
        assert_eq!(sources[1].address, None);
        assert!(!sources[1].direct);
        assert!(sources[1].low_id);
        assert_eq!(sources[1].client_id, Some(12_345));
    }

    #[test]
    fn filters_non_public_high_id_sources() {
        let hash = [0xCD; 16];
        let server = NativeEd2kServer {
            address: "5.6.7.8".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
            udp_flags: 0,
        };
        let mut payload = Vec::new();
        payload.extend_from_slice(&hash);
        payload.push(1);
        push_u32(
            &mut payload,
            u32::from_le_bytes([192, 168, 1, 5]),
        );
        push_u16(&mut payload, 4662);

        assert!(parse_found_sources(&payload, &hash, &server)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn validates_and_normalizes_ed2k_hashes() {
        let parsed = parse_ed2k_hash("AABBCCDDEEFF00112233445566778899")
            .unwrap();
        assert_eq!(
            hash_hex(&parsed),
            "aabbccddeeff00112233445566778899"
        );
        assert!(parse_ed2k_hash("not-a-hash").is_err());
    }

    #[test]
    fn merges_duplicate_direct_sources() {
        let first = NativeEd2kSource {
            address: Some("8.8.8.8".to_string()),
            tcp_port: 4662,
            udp_port: None,
            origin: "server-tcp".to_string(),
            direct: true,
            low_id: false,
            client_id: Some(1),
            source_id: None,
            server: Some("one:4661".to_string()),
            buddy_address: None,
            buddy_port: None,
            buddy_id: None,
            source_type: None,
            encryption: None,
        };
        let mut second = first.clone();
        second.udp_port = Some(4672);
        second.source_type = Some(1);

        let merged = merge_sources(vec![vec![first], vec![second]]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].udp_port, Some(4672));
        assert_eq!(merged[0].source_type, Some(1));
    }

    #[test]
    fn encodes_udp_global_search_for_modern_server() {
        let server = NativeEd2kServer {
            address: "1.2.3.4".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
            udp_flags: SRV_UDPFLG_EXT_GETFILES,
        };

        let packet = encode_udp_search_packet(&server, "history").unwrap();
        assert_eq!(packet[0], OP_EDONKEYPROT);
        assert_eq!(packet[1], OP_GLOBSEARCHREQ2);
        assert_eq!(packet[2], 0x01);
    }

    #[test]
    fn falls_back_to_legacy_udp_global_search_opcode() {
        let server = NativeEd2kServer {
            address: "9.8.7.6".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
            udp_flags: 0,
        };

        let packet = encode_udp_search_packet(&server, "history").unwrap();
        assert_eq!(packet[0], OP_EDONKEYPROT);
        assert_eq!(packet[1], OP_GLOBSEARCHREQ);
    }

    #[test]
    fn parses_multiple_udp_global_results_in_one_datagram() {
        let server = NativeEd2kServer {
            address: "5.6.7.8".to_string(),
            port: 4661,
            name: None,
            users: None,
            files: None,
            failed_count: 0,
            preference: 0,
            udp_flags: 0,
        };

        fn one_result(hash_byte: u8, name: &str, size: u32) -> Vec<u8> {
            let mut result = Vec::new();
            result.extend_from_slice(&[hash_byte; 16]);
            push_u32(&mut result, 0);
            push_u16(&mut result, 0);
            push_u32(&mut result, 2);
            result.extend_from_slice(&old_string_tag(FT_FILENAME, name));
            result.extend_from_slice(&old_u32_tag(FT_FILESIZE, size));
            result
        }

        let mut datagram = vec![OP_EDONKEYPROT, OP_GLOBSEARCHRES];
        datagram.extend_from_slice(&one_result(
            0x11,
            "One Book.pdf",
            100,
        ));
        datagram.extend_from_slice(&[
            OP_EDONKEYPROT,
            OP_GLOBSEARCHRES,
        ]);
        datagram.extend_from_slice(&one_result(
            0x22,
            "Two Book.epub",
            200,
        ));

        let results = parse_udp_search_datagram(&datagram, &server).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "One Book.pdf");
        assert_eq!(results[1].name, "Two Book.epub");
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

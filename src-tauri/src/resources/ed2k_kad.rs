use flate2::read::ZlibDecoder;
use md4::{Digest, Md4};
use md5::Md5;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::{
    fs,
    net::UdpSocket,
    time::{timeout, Instant},
};

use super::ed2k_native::{NativeEd2kSearchResult, NativeEd2kSource, OLD_MAX_FILE_SIZE};

const NODES_DAT_URL: &str = "https://upd.emule-security.org/nodes.dat";
const NODES_DAT_CACHE_SECONDS: u64 = 6 * 60 * 60;
const MAX_NODES_DAT_BYTES: usize = 8 * 1024 * 1024;
const MAX_NODES: usize = 20_000;
const MAX_KAD_DATAGRAM: usize = 65_507;
const MAX_KAD_DECOMPRESSED: usize = 2 * 1024 * 1024;
const MAX_KAD_CONTACTS: usize = 2_000;
const MAX_KAD_RESULTS: usize = 2_000;
const MAX_KAD_TAGS: usize = 128;

const BOOTSTRAP_SEEDS: usize = 8;
const BOOTSTRAP_WAIT: Duration = Duration::from_millis(1_800);
const LOOKUP_ROUNDS: usize = 3;
const LOOKUP_ALPHA: usize = 5;
const LOOKUP_WAIT: Duration = Duration::from_millis(1_100);
const KEYWORD_CONTACTS: usize = 6;
const KEYWORD_WAIT: Duration = Duration::from_millis(2_500);
const SOURCE_CONTACTS: usize = 8;
const SOURCE_WAIT: Duration = Duration::from_millis(2_800);

const OP_KADEMLIAHEADER: u8 = 0xE4;
const OP_KADEMLIAPACKEDPROT: u8 = 0xE5;
const KADEMLIA2_BOOTSTRAP_REQ: u8 = 0x01;
const KADEMLIA2_BOOTSTRAP_RES: u8 = 0x09;
const KADEMLIA2_REQ: u8 = 0x21;
const KADEMLIA2_RES: u8 = 0x29;
const KADEMLIA2_SEARCH_KEY_REQ: u8 = 0x33;
const KADEMLIA2_SEARCH_SOURCE_REQ: u8 = 0x34;
const KADEMLIA2_SEARCH_RES: u8 = 0x3B;
const KADEMLIA_FIND_VALUE: u8 = 0x02;

const MAGICVALUE_UDP_SYNC_CLIENT: u32 = 0x395F_2EC1;

const TAG_FILENAME: u8 = 0x01;
const TAG_FILESIZE: u8 = 0x02;
const TAG_FILESIZE_HI: u8 = 0x3A;
const TAG_SOURCES: u8 = 0x15;
const TAG_ENCRYPTION: u8 = 0xF3;
const TAG_BUDDYHASH: u8 = 0xF8;
const TAG_CLIENTLOWID: u8 = 0xF9;
const TAG_SERVERPORT: u8 = 0xFA;
const TAG_SERVERIP: u8 = 0xFB;
const TAG_SOURCEUPORT: u8 = 0xFC;
const TAG_SOURCEPORT: u8 = 0xFD;
const TAG_SOURCEIP: u8 = 0xFE;
const TAG_SOURCETYPE: u8 = 0xFF;

static NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub(crate) struct KadSearchOutcome {
    pub nodes_source: String,
    pub contacts_loaded: usize,
    pub contacts_discovered: usize,
    pub bootstrap_queried: usize,
    pub bootstrap_responded: usize,
    pub lookup_queried: usize,
    pub lookup_responded: usize,
    pub keyword_queried: usize,
    pub keyword_responded: usize,
    pub results: Vec<NativeEd2kSearchResult>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct KadSourceOutcome {
    pub nodes_source: String,
    pub contacts_loaded: usize,
    pub contacts_discovered: usize,
    pub bootstrap_queried: usize,
    pub bootstrap_responded: usize,
    pub lookup_queried: usize,
    pub lookup_responded: usize,
    pub source_queried: usize,
    pub source_responded: usize,
    pub sources: Vec<NativeEd2kSource>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KadContact {
    id: [u8; 16],
    address: Ipv4Addr,
    udp_port: u16,
    tcp_port: u16,
    version: u8,
    udp_key: u32,
    udp_key_ip: u32,
    verified: bool,
}

#[derive(Debug, Clone)]
enum KadTagValue {
    String(String),
    Integer(u64),
    Other,
}

#[derive(Debug, Clone)]
struct KadTag {
    name_id: Option<u8>,
    value: KadTagValue,
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn bytes(&mut self, count: usize) -> Result<&'a [u8], String> {
        if count > self.remaining() {
            return Err(format!(
                "Kad packet is truncated at offset {} (need {}, have {}).",
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

    fn id(&mut self) -> Result<[u8; 16], String> {
        let mut id = [0u8; 16];
        id.copy_from_slice(self.bytes(16)?);
        Ok(id)
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

fn read_kad_tag(cursor: &mut Cursor<'_>) -> Result<KadTag, String> {
    let raw_type = cursor.u8()?;
    let (tag_type, name_id) = if raw_type & 0x80 != 0 {
        (raw_type & 0x7F, Some(cursor.u8()?))
    } else {
        let name_len = cursor.u16()? as usize;
        if name_len == 0 || name_len > 1024 {
            return Err(format!("Kad tag has invalid name length {name_len}."));
        }
        let name = cursor.bytes(name_len)?;
        (raw_type, (name_len == 1).then_some(name[0]))
    };

    let value = match tag_type {
        0x01 => {
            let _ = cursor.bytes(16)?;
            KadTagValue::Other
        }
        0x02 => {
            let len = cursor.u16()? as usize;
            KadTagValue::String(decode_text(cursor.bytes(len)?))
        }
        0x03 => KadTagValue::Integer(cursor.u32()? as u64),
        0x04 => {
            let _ = cursor.bytes(4)?;
            KadTagValue::Other
        }
        0x05 => {
            let _ = cursor.u8()?;
            KadTagValue::Other
        }
        0x06 => {
            let bit_count = cursor.u16()? as usize;
            let _ = cursor.bytes((bit_count / 8) + 1)?;
            KadTagValue::Other
        }
        0x07 => {
            let len = cursor.u32()? as usize;
            let _ = cursor.bytes(len)?;
            KadTagValue::Other
        }
        0x08 => KadTagValue::Integer(cursor.u16()? as u64),
        0x09 => KadTagValue::Integer(cursor.u8()? as u64),
        0x0A => {
            let len = cursor.u8()? as usize;
            let _ = cursor.bytes(len)?;
            KadTagValue::Other
        }
        0x0B => KadTagValue::Integer(cursor.u64()?),
        0x11..=0x26 => {
            let len = (tag_type - 0x11 + 1) as usize;
            KadTagValue::String(decode_text(cursor.bytes(len)?))
        }
        _ => {
            return Err(format!(
                "Unsupported Kad tag type 0x{tag_type:02x}."
            ))
        }
    };

    Ok(KadTag { name_id, value })
}

fn tag_integer(tag: &KadTag) -> Option<u64> {
    match &tag.value {
        KadTagValue::Integer(value) => Some(*value),
        _ => None,
    }
}

fn tag_string(tag: &KadTag) -> Option<&str> {
    match &tag.value {
        KadTagValue::String(value) => Some(value),
        _ => None,
    }
}

fn valid_contact_address(address: Ipv4Addr, port: u16) -> bool {
    port != 0
        && !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_private()
        && !address.is_link_local()
        && !address.is_documentation()
        && !address.is_multicast()
        && !address.is_broadcast()
}

fn read_contact(
    cursor: &mut Cursor<'_>,
    with_key: bool,
) -> Result<Option<KadContact>, String> {
    let id = cursor.id()?;
    // Kad stores the IPv4 value as a little-endian u32. Convert the
    // numeric address back to network byte order before creating Ipv4Addr.
    let raw_ip = cursor.u32()?;
    let address = Ipv4Addr::from(raw_ip.to_be_bytes());
    let udp_port = cursor.u16()?;
    let tcp_port = cursor.u16()?;
    let version = cursor.u8()?;

    let (udp_key, udp_key_ip, verified) = if with_key {
        (cursor.u32()?, cursor.u32()?, cursor.u8()? != 0)
    } else {
        (0, 0, false)
    };

    if version <= 1 || !valid_contact_address(address, udp_port) {
        return Ok(None);
    }

    Ok(Some(KadContact {
        id,
        address,
        udp_port,
        tcp_port,
        version,
        udp_key,
        udp_key_ip,
        verified,
    }))
}

fn parse_nodes_dat(data: &[u8]) -> Result<Vec<KadContact>, String> {
    let mut cursor = Cursor::new(data);
    let legacy_count = cursor.u32()? as usize;
    if legacy_count != 0 {
        return Err(
            "nodes.dat version 0 is intentionally unsupported because contacts have no Kad version."
                .to_string(),
        );
    }

    let version = cursor.u32()?;
    if !(1..=3).contains(&version) {
        return Err(format!("Unsupported nodes.dat version {version}."));
    }

    let mut bootstrap_only = false;
    let count = if version == 3 {
        let edition = cursor.u32()?;
        if edition == 1 {
            bootstrap_only = true;
            cursor.u32()? as usize
        } else {
            cursor.u32()? as usize
        }
    } else {
        cursor.u32()? as usize
    };

    if count > MAX_NODES {
        return Err(format!(
            "nodes.dat declares an unreasonable contact count: {count}."
        ));
    }

    let with_key = version >= 2 && !bootstrap_only;
    let record_size = if with_key { 34usize } else { 25usize };
    let required = count
        .checked_mul(record_size)
        .ok_or_else(|| "nodes.dat contact size overflow.".to_string())?;
    if cursor.remaining() < required {
        return Err(format!(
            "nodes.dat is truncated (need {required} contact bytes, have {}).",
            cursor.remaining()
        ));
    }

    let mut contacts = Vec::with_capacity(count.min(MAX_KAD_CONTACTS));
    for _ in 0..count {
        if let Some(contact) = read_contact(&mut cursor, with_key)? {
            contacts.push(contact);
        }
    }

    dedupe_contacts(&mut contacts);
    if contacts.len() > MAX_KAD_CONTACTS {
        contacts.truncate(MAX_KAD_CONTACTS);
    }

    if contacts.is_empty() {
        return Err("nodes.dat contains no usable Kad2 contacts.".to_string());
    }
    Ok(contacts)
}

fn dedupe_contacts(contacts: &mut Vec<KadContact>) {
    let mut unique: HashMap<(Ipv4Addr, u16), KadContact> = HashMap::new();
    for contact in contacts.drain(..) {
        let key = (contact.address, contact.udp_port);
        match unique.get(&key) {
            Some(existing) if existing.version >= contact.version => {}
            _ => {
                unique.insert(key, contact);
            }
        }
    }
    contacts.extend(unique.into_values());
}

fn nodes_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("resource-ed2k-native").join("nodes.dat"))
        .map_err(|error| {
            format!("Unable to resolve Kad nodes.dat cache directory: {error}")
        })
}

async fn read_fresh_cache(path: &PathBuf) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).await.ok()?;
    let modified = metadata.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age.as_secs() > NODES_DAT_CACHE_SECONDS {
        return None;
    }
    fs::read(path).await.ok()
}

async fn load_nodes_dat(
    app: &AppHandle,
) -> Result<(Vec<KadContact>, String), String> {
    let path = nodes_cache_path(app)?;

    if let Some(bytes) = read_fresh_cache(&path).await {
        if let Ok(contacts) = parse_nodes_dat(&bytes) {
            return Ok((contacts, "cache".to_string()));
        }
    }

    let download = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| {
                format!("Unable to create Kad bootstrap HTTP client: {error}")
            })?;
        let response = client
            .get(NODES_DAT_URL)
            .send()
            .await
            .map_err(|error| format!("Unable to download nodes.dat: {error}"))?
            .error_for_status()
            .map_err(|error| format!("nodes.dat download failed: {error}"))?;
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Unable to read nodes.dat: {error}"))?
            .to_vec();
        if bytes.len() > MAX_NODES_DAT_BYTES {
            return Err(format!(
                "Downloaded nodes.dat is unexpectedly large: {} bytes.",
                bytes.len()
            ));
        }
        let contacts = parse_nodes_dat(&bytes)?;

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| {
                    format!("Unable to create Kad cache directory: {error}")
                })?;
        }
        fs::write(&path, &bytes)
            .await
            .map_err(|error| format!("Unable to cache nodes.dat: {error}"))?;

        Ok::<Vec<KadContact>, String>(contacts)
    }
    .await;

    match download {
        Ok(contacts) => Ok((contacts, "network".to_string())),
        Err(download_error) => {
            if let Ok(bytes) = fs::read(&path).await {
                let contacts = parse_nodes_dat(&bytes)?;
                Ok((contacts, "stale-cache".to_string()))
            } else {
                Err(download_error)
            }
        }
    }
}

fn keyword_terms(query: &str) -> Result<Vec<String>, String> {
    const INVALID: &str = "()[]{}<>,._-!?:;\\/\"";
    let terms = query
        .split(|ch: char| ch.is_whitespace() || INVALID.contains(ch))
        .filter(|term| !term.is_empty())
        .map(|term| term.to_lowercase())
        .filter(|term| term.as_bytes().len() >= 3)
        .take(16)
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Err(
            "Kad search needs at least one keyword of three UTF-8 bytes."
                .to_string(),
        );
    }

    Ok(terms)
}

fn wire_to_be(id: &[u8; 16]) -> [u8; 16] {
    let mut chunks = [0u32; 4];
    for (index, chunk) in chunks.iter_mut().enumerate() {
        let offset = index * 4;
        *chunk = u32::from_le_bytes([
            id[offset],
            id[offset + 1],
            id[offset + 2],
            id[offset + 3],
        ]);
    }

    let mut out = [0u8; 16];
    for index in 0..4 {
        out[index * 4..index * 4 + 4]
            .copy_from_slice(&chunks[3 - index].to_be_bytes());
    }
    out
}

fn be_to_wire(value: &[u8; 16]) -> [u8; 16] {
    let mut chunks_be = [0u32; 4];
    for (index, chunk) in chunks_be.iter_mut().enumerate() {
        let offset = index * 4;
        *chunk = u32::from_be_bytes([
            value[offset],
            value[offset + 1],
            value[offset + 2],
            value[offset + 3],
        ]);
    }

    let mut out = [0u8; 16];
    for index in 0..4 {
        out[index * 4..index * 4 + 4]
            .copy_from_slice(&chunks_be[3 - index].to_le_bytes());
    }
    out
}

fn crypt_value_from_wire(id: &[u8; 16]) -> [u8; 16] {
    let mut out = [0u8; 16];
    for index in 0..4 {
        let source = (3 - index) * 4;
        out[index * 4..index * 4 + 4]
            .copy_from_slice(&id[source..source + 4]);
    }
    out
}

fn file_target(hash_be: &[u8; 16]) -> [u8; 16] {
    be_to_wire(hash_be)
}

fn keyword_target(query: &str) -> Result<([u8; 16], Vec<String>), String> {
    let terms = keyword_terms(query)?;
    let digest = Md4::digest(terms[0].as_bytes());
    let mut be = [0u8; 16];
    be.copy_from_slice(&digest);
    Ok((be_to_wire(&be), terms))
}

fn make_local_kad_id() -> [u8; 16] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
    let seed = format!(
        "LexiPane Kad:{}:{nanos}:{nonce}",
        std::process::id()
    );
    let digest = Md5::digest(seed.as_bytes());
    let mut be = [0u8; 16];
    be.copy_from_slice(&digest);
    be_to_wire(&be)
}

fn distance_key(id: &[u8; 16], target: &[u8; 16]) -> [u8; 16] {
    let id_be = wire_to_be(id);
    let target_be = wire_to_be(target);
    let mut distance = [0u8; 16];
    for index in 0..16 {
        distance[index] = id_be[index] ^ target_be[index];
    }
    distance
}

fn closest_contacts(
    contacts: &HashMap<(Ipv4Addr, u16), KadContact>,
    target: &[u8; 16],
    limit: usize,
    minimum_version: u8,
    excluded: &HashSet<(Ipv4Addr, u16)>,
) -> Vec<KadContact> {
    let mut values = contacts
        .values()
        .filter(|contact| {
            contact.version >= minimum_version
                && !excluded.contains(&(contact.address, contact.udp_port))
        })
        .cloned()
        .collect::<Vec<_>>();
    values.sort_by_key(|contact| distance_key(&contact.id, target));
    values.truncate(limit);
    values
}

fn upsert_contact(
    contacts: &mut HashMap<(Ipv4Addr, u16), KadContact>,
    contact: KadContact,
) -> bool {
    if contacts.len() >= MAX_KAD_CONTACTS {
        return false;
    }

    let key = (contact.address, contact.udp_port);
    match contacts.get(&key) {
        Some(existing) if existing.version >= contact.version => false,
        _ => {
            contacts.insert(key, contact);
            true
        }
    }
}

struct Rc4 {
    state: [u8; 256],
    x: u8,
    y: u8,
}

impl Rc4 {
    fn new(key: &[u8]) -> Self {
        let mut state = [0u8; 256];
        for (index, value) in state.iter_mut().enumerate() {
            *value = index as u8;
        }

        let mut j = 0usize;
        for i in 0..256usize {
            j = (j + state[i] as usize + key[i % key.len()] as usize) & 0xFF;
            state.swap(i, j);
        }

        Self { state, x: 0, y: 0 }
    }

    fn crypt(&mut self, input: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(input.len());
        for byte in input {
            self.x = self.x.wrapping_add(1);
            self.y = self
                .y
                .wrapping_add(self.state[self.x as usize]);
            self.state.swap(self.x as usize, self.y as usize);
            let index = self.state[self.x as usize]
                .wrapping_add(self.state[self.y as usize]);
            output.push(*byte ^ self.state[index as usize]);
        }
        output
    }

    fn discard(&mut self, count: usize) {
        let zeros = vec![0u8; count];
        let _ = self.crypt(&zeros);
    }
}

fn next_random_key_part() -> u16 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
    let digest = Md5::digest(format!("{nanos}:{nonce}").as_bytes());
    u16::from_le_bytes([digest[0], digest[1]])
}

fn kad_plain_packet(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(payload.len() + 2);
    packet.push(OP_KADEMLIAHEADER);
    packet.push(opcode);
    packet.extend_from_slice(payload);
    packet
}

fn encrypt_kad_packet(
    packet: &[u8],
    target_id: &[u8; 16],
) -> Vec<u8> {
    let random_key_part = next_random_key_part();
    let mut key_data = Vec::with_capacity(18);
    key_data.extend_from_slice(&crypt_value_from_wire(target_id));
    key_data.extend_from_slice(&random_key_part.to_le_bytes());
    let key = Md5::digest(&key_data);

    let mut rc4 = Rc4::new(&key);
    let mut marker = key[0] & 0xFC;
    if matches!(
        marker,
        OP_KADEMLIAHEADER | OP_KADEMLIAPACKEDPROT | 0xD4
    ) {
        marker = 0x44;
    }

    let mut out = Vec::with_capacity(packet.len() + 16);
    out.push(marker);
    out.extend_from_slice(&random_key_part.to_le_bytes());
    out.extend_from_slice(
        &rc4.crypt(&MAGICVALUE_UDP_SYNC_CLIENT.to_le_bytes()),
    );
    out.extend_from_slice(&rc4.crypt(&[0u8]));
    out.extend_from_slice(&rc4.crypt(&0u32.to_le_bytes()));
    out.extend_from_slice(&rc4.crypt(&0u32.to_le_bytes()));
    out.extend_from_slice(&rc4.crypt(packet));
    out
}

fn decrypt_kad_packet(
    packet: &[u8],
    local_id: &[u8; 16],
) -> Result<Vec<u8>, String> {
    if packet.len() < 2 {
        return Err("Kad UDP datagram is too short.".to_string());
    }
    if packet[0] == OP_KADEMLIAHEADER
        || packet[0] == OP_KADEMLIAPACKEDPROT
    {
        return Ok(packet.to_vec());
    }
    if packet.len() <= 16 {
        return Err("Encrypted Kad UDP datagram is too short.".to_string());
    }

    let mut key_data = Vec::with_capacity(18);
    key_data.extend_from_slice(&crypt_value_from_wire(local_id));
    key_data.extend_from_slice(&packet[1..3]);
    let key = Md5::digest(&key_data);
    let mut rc4 = Rc4::new(&key);

    let magic = rc4.crypt(&packet[3..7]);
    if u32::from_le_bytes([magic[0], magic[1], magic[2], magic[3]])
        != MAGICVALUE_UDP_SYNC_CLIENT
    {
        return Err("Kad UDP encryption key did not match.".to_string());
    }

    let pad_len = rc4.crypt(&packet[7..8])[0] as usize;
    if pad_len > 16 || packet.len() < 16 + pad_len {
        return Err("Kad UDP encrypted padding is invalid.".to_string());
    }

    rc4.discard(pad_len);
    let verify_start = 8 + pad_len;
    let _ = rc4.crypt(&packet[verify_start..verify_start + 4]);
    let _ = rc4.crypt(&packet[verify_start + 4..verify_start + 8]);
    Ok(rc4.crypt(&packet[verify_start + 8..]))
}

fn decode_kad_datagram(
    packet: &[u8],
    local_id: &[u8; 16],
) -> Result<(u8, Vec<u8>), String> {
    let decrypted = decrypt_kad_packet(packet, local_id)?;
    if decrypted.len() < 2 {
        return Err("Decoded Kad packet is too short.".to_string());
    }

    let protocol = decrypted[0];
    let opcode = decrypted[1];
    match protocol {
        OP_KADEMLIAHEADER => Ok((opcode, decrypted[2..].to_vec())),
        OP_KADEMLIAPACKEDPROT => {
            let mut decoder = ZlibDecoder::new(&decrypted[2..]);
            let mut unpacked = Vec::new();
            decoder
                .read_to_end(&mut unpacked)
                .map_err(|error| {
                    format!("Unable to decompress Kad packet: {error}")
                })?;
            if unpacked.len() > MAX_KAD_DECOMPRESSED {
                return Err("Decompressed Kad packet is too large.".to_string());
            }
            Ok((opcode, unpacked))
        }
        _ => Err(format!(
            "Unexpected Kad protocol byte 0x{protocol:02x}."
        )),
    }
}

async fn send_kad(
    socket: &UdpSocket,
    contact: &KadContact,
    opcode: u8,
    payload: &[u8],
) -> Result<(), String> {
    let plain = kad_plain_packet(opcode, payload);
    let packet = if contact.version >= 6 {
        encrypt_kad_packet(&plain, &contact.id)
    } else {
        plain
    };
    let endpoint = SocketAddr::V4(SocketAddrV4::new(
        contact.address,
        contact.udp_port,
    ));
    socket
        .send_to(&packet, endpoint)
        .await
        .map(|_| ())
        .map_err(|error| {
            format!(
                "Unable to send Kad packet to {}:{}: {error}",
                contact.address, contact.udp_port
            )
        })
}

fn parse_bootstrap_response(
    payload: &[u8],
    source: SocketAddrV4,
) -> Result<Vec<KadContact>, String> {
    let mut cursor = Cursor::new(payload);
    let sender_id = cursor.id()?;
    let sender_tcp = cursor.u16()?;
    let sender_version = cursor.u8()?;
    let count = cursor.u16()? as usize;
    if count > 64 {
        return Err(format!(
            "Kad bootstrap response contains too many contacts: {count}."
        ));
    }

    let mut contacts = Vec::with_capacity(count + 1);
    if sender_version > 1
        && valid_contact_address(*source.ip(), source.port())
    {
        contacts.push(KadContact {
            id: sender_id,
            address: *source.ip(),
            udp_port: source.port(),
            tcp_port: sender_tcp,
            version: sender_version,
            udp_key: 0,
            udp_key_ip: 0,
            verified: true,
        });
    }

    for _ in 0..count {
        if let Some(contact) = read_contact(&mut cursor, false)? {
            contacts.push(contact);
        }
    }
    Ok(contacts)
}

fn parse_lookup_response(
    payload: &[u8],
    expected_target: &[u8; 16],
) -> Result<Vec<KadContact>, String> {
    let mut cursor = Cursor::new(payload);
    let target = cursor.id()?;
    if &target != expected_target {
        return Err("Kad lookup response target does not match.".to_string());
    }
    let count = cursor.u8()? as usize;
    if count > 32 {
        return Err(format!(
            "Kad lookup response contains too many contacts: {count}."
        ));
    }

    let expected = count
        .checked_mul(25)
        .ok_or_else(|| "Kad lookup contact size overflow.".to_string())?;
    if cursor.remaining() != expected {
        return Err(format!(
            "Kad lookup response has invalid contact bytes: expected {expected}, got {}.",
            cursor.remaining()
        ));
    }

    let mut contacts = Vec::with_capacity(count);
    for _ in 0..count {
        if let Some(contact) = read_contact(&mut cursor, false)? {
            contacts.push(contact);
        }
    }
    Ok(contacts)
}

fn hash_hex(hash: &[u8; 16]) -> String {
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

fn matches_query(name: &str, terms: &[String]) -> bool {
    let lower = name.to_lowercase();
    terms.iter().all(|term| lower.contains(term))
}

fn normalized_hash_string(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Some(value.to_ascii_lowercase())
    } else {
        None
    }
}

fn public_tag_address(value: u64) -> Option<Ipv4Addr> {
    let value = u32::try_from(value).ok()?;
    let address = Ipv4Addr::from(value.to_be_bytes());
    valid_contact_address(address, 1).then_some(address)
}

fn parse_source_response(
    payload: &[u8],
    expected_target: &[u8; 16],
    expected_size: u64,
) -> Result<Vec<NativeEd2kSource>, String> {
    let mut cursor = Cursor::new(payload);
    let _sender_id = cursor.id()?;
    let target = cursor.id()?;
    if &target != expected_target {
        return Err("Kad source response target does not match.".to_string());
    }

    let count = cursor.u16()? as usize;
    if count > MAX_KAD_RESULTS {
        return Err(format!(
            "Kad source response contains too many results: {count}."
        ));
    }

    let mut sources = Vec::with_capacity(count);
    for _ in 0..count {
        let answer = cursor.id()?;
        let source_id = hash_hex(&wire_to_be(&answer));
        let tag_count = cursor.u8()? as usize;
        if tag_count > MAX_KAD_TAGS {
            return Err(format!(
                "Kad source result contains too many tags: {tag_count}."
            ));
        }

        let mut source_type = 0u8;
        let mut source_ip = None;
        let mut source_tcp = 0u16;
        let mut source_udp = None;
        let mut buddy_ip = None;
        let mut buddy_port = None;
        let mut buddy_id = None;
        let mut client_low_id = None;
        let mut encryption = None;
        let mut published_size = None;

        for _ in 0..tag_count {
            let tag = read_kad_tag(&mut cursor)?;
            match tag.name_id {
                Some(TAG_SOURCETYPE) => {
                    source_type = tag_integer(&tag)
                        .and_then(|value| u8::try_from(value).ok())
                        .unwrap_or(0);
                }
                Some(TAG_SOURCEIP) => {
                    source_ip = tag_integer(&tag).and_then(public_tag_address);
                }
                Some(TAG_SOURCEPORT) => {
                    source_tcp = tag_integer(&tag)
                        .and_then(|value| u16::try_from(value).ok())
                        .unwrap_or(0);
                }
                Some(TAG_SOURCEUPORT) => {
                    source_udp = tag_integer(&tag)
                        .and_then(|value| u16::try_from(value).ok())
                        .filter(|value| *value != 0);
                }
                Some(TAG_SERVERIP) => {
                    buddy_ip = tag_integer(&tag).and_then(public_tag_address);
                }
                Some(TAG_SERVERPORT) => {
                    buddy_port = tag_integer(&tag)
                        .and_then(|value| u16::try_from(value).ok())
                        .filter(|value| *value != 0);
                }
                Some(TAG_BUDDYHASH) => {
                    buddy_id = tag_string(&tag).and_then(normalized_hash_string);
                }
                Some(TAG_CLIENTLOWID) => {
                    client_low_id = tag_integer(&tag)
                        .and_then(|value| u32::try_from(value).ok());
                }
                Some(TAG_ENCRYPTION) => {
                    encryption = tag_integer(&tag)
                        .and_then(|value| u8::try_from(value).ok());
                }
                Some(TAG_FILESIZE) => {
                    published_size = tag_integer(&tag);
                }
                _ => {}
            }
        }

        if !matches!(source_type, 1 | 3 | 4 | 5 | 6) {
            continue;
        }
        if published_size
            .is_some_and(|published| published != expected_size)
        {
            continue;
        }

        let is_large = expected_size > OLD_MAX_FILE_SIZE;
        if source_tcp == 0
            || (is_large && matches!(source_type, 1 | 3))
            || (!is_large && matches!(source_type, 4 | 5))
        {
            continue;
        }

        let firewalled = matches!(source_type, 3 | 5 | 6);
        if matches!(source_type, 1 | 4) && source_ip.is_none() {
            continue;
        }
        if source_type == 6
            && (source_ip.is_none()
                || source_udp.is_none()
                || encryption.unwrap_or(0) & 0x08 == 0)
        {
            // Type 6 is useful only when the source advertises the direct
            // UDP-callback capability bit, matching established eMule logic.
            continue;
        }
        if matches!(source_type, 3 | 5)
            && (buddy_ip.is_none()
                || buddy_port.is_none()
                || buddy_id.is_none())
        {
            // Kad-only firewalled sources need the complete buddy tuple for
            // a later callback; incomplete publications are not actionable.
            continue;
        }

        sources.push(NativeEd2kSource {
            address: source_ip.map(|address| address.to_string()),
            tcp_port: source_tcp,
            udp_port: source_udp,
            origin: "kad".to_string(),
            direct: matches!(source_type, 1 | 4),
            low_id: firewalled,
            client_id: client_low_id,
            source_id: Some(source_id),
            server: None,
            buddy_address: buddy_ip.map(|address| address.to_string()),
            buddy_port,
            buddy_id,
            source_type: Some(source_type),
            encryption,
        });
    }

    Ok(sources)
}

fn parse_search_response(
    payload: &[u8],
    expected_target: &[u8; 16],
    source: SocketAddrV4,
    terms: &[String],
) -> Result<Vec<NativeEd2kSearchResult>, String> {
    let mut cursor = Cursor::new(payload);
    let _sender_id = cursor.id()?;
    let target = cursor.id()?;
    if &target != expected_target {
        return Err("Kad keyword response target does not match.".to_string());
    }

    let count = cursor.u16()? as usize;
    if count > MAX_KAD_RESULTS {
        return Err(format!(
            "Kad keyword response contains too many results: {count}."
        ));
    }

    let mut results = Vec::with_capacity(count);
    for _ in 0..count {
        let answer = cursor.id()?;
        let tag_count = cursor.u8()? as usize;
        if tag_count > MAX_KAD_TAGS {
            return Err(format!(
                "Kad keyword result contains too many tags: {tag_count}."
            ));
        }

        let mut name = None;
        let mut size = 0u64;
        let mut size_hi = 0u64;
        let mut sources = 0u64;

        for _ in 0..tag_count {
            let tag = read_kad_tag(&mut cursor)?;
            match tag.name_id {
                Some(TAG_FILENAME) => {
                    if let Some(value) = tag_string(&tag) {
                        name = Some(value.to_string());
                    }
                }
                Some(TAG_FILESIZE) => {
                    size = tag_integer(&tag).unwrap_or(0);
                }
                Some(TAG_FILESIZE_HI) => {
                    size_hi = tag_integer(&tag).unwrap_or(0);
                }
                Some(TAG_SOURCES) => {
                    sources = tag_integer(&tag).unwrap_or(0).min(65_500);
                }
                _ => {}
            }
        }

        let Some(name) = name.filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let size = size.saturating_add(size_hi << 32);
        if size == 0 || !matches_query(&name, terms) {
            continue;
        }

        let hash_be = wire_to_be(&answer);
        let hash = hash_hex(&hash_be);
        let encoded_name = urlencoding::encode(&name);
        let ed2k_link = format!(
            "ed2k://|file|{encoded_name}|{size}|{hash}|/"
        );

        results.push(NativeEd2kSearchResult {
            hash,
            name: name.clone(),
            size,
            sources,
            complete_sources: 0,
            book_candidate: is_book_candidate(&name),
            ed2k_link,
            servers: vec![format!(
                "Kad {}:{}",
                source.ip(),
                source.port()
            )],
        });
    }

    Ok(results)
}

async fn recv_packet(
    socket: &UdpSocket,
    local_id: &[u8; 16],
    wait: Duration,
    buffer: &mut [u8],
) -> Result<Option<(SocketAddrV4, u8, Vec<u8>)>, String> {
    let received = match timeout(wait, socket.recv_from(buffer)).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            return Err(format!("Kad UDP receive failed: {error}"));
        }
        Err(_) => return Ok(None),
    };

    let (length, source) = received;
    if length == 0 {
        return Ok(None);
    }
    let SocketAddr::V4(source) = source else {
        return Ok(None);
    };
    let (opcode, payload) = decode_kad_datagram(&buffer[..length], local_id)?;
    Ok(Some((source, opcode, payload)))
}

fn contact_map(contacts: Vec<KadContact>) -> HashMap<(Ipv4Addr, u16), KadContact> {
    let mut map = HashMap::new();
    for contact in contacts {
        let _ = upsert_contact(&mut map, contact);
    }
    map
}

async fn collect_bootstrap(
    socket: &UdpSocket,
    local_id: &[u8; 16],
    contacts: &mut HashMap<(Ipv4Addr, u16), KadContact>,
    responsive: &mut HashSet<(Ipv4Addr, u16)>,
) -> (usize, usize, Vec<String>) {
    let excluded = HashSet::new();
    let seeds = closest_contacts(
        contacts,
        local_id,
        BOOTSTRAP_SEEDS,
        2,
        &excluded,
    );

    let mut queried = 0usize;
    let mut errors = Vec::new();
    for contact in &seeds {
        match send_kad(socket, contact, KADEMLIA2_BOOTSTRAP_REQ, &[]).await {
            Ok(()) => queried += 1,
            Err(error) => errors.push(error),
        }
    }

    let deadline = Instant::now() + BOOTSTRAP_WAIT;
    let mut buffer = vec![0u8; MAX_KAD_DATAGRAM];
    let mut responders = HashSet::new();

    while Instant::now() < deadline {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(350));
        match recv_packet(socket, local_id, wait, &mut buffer).await {
            Ok(Some((source, opcode, payload))) => {
                if opcode != KADEMLIA2_BOOTSTRAP_RES {
                    continue;
                }
                match parse_bootstrap_response(&payload, source) {
                    Ok(found) => {
                        responders.insert((*source.ip(), source.port()));
                        responsive.insert((*source.ip(), source.port()));
                        for contact in found {
                            let _ = upsert_contact(contacts, contact);
                        }
                    }
                    Err(error) => errors.push(format!(
                        "Kad bootstrap response from {source}: {error}"
                    )),
                }
            }
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }

    (queried, responders.len(), errors)
}

async fn collect_lookup(
    socket: &UdpSocket,
    local_id: &[u8; 16],
    target: &[u8; 16],
    contacts: &mut HashMap<(Ipv4Addr, u16), KadContact>,
    responsive: &mut HashSet<(Ipv4Addr, u16)>,
) -> (usize, usize, Vec<String>) {
    let mut queried_keys = HashSet::new();
    let mut total_queried = 0usize;
    let mut response_keys = HashSet::new();
    let mut errors = Vec::new();
    let mut buffer = vec![0u8; MAX_KAD_DATAGRAM];

    for _ in 0..LOOKUP_ROUNDS {
        let batch = closest_contacts(
            contacts,
            target,
            LOOKUP_ALPHA,
            2,
            &queried_keys,
        );
        if batch.is_empty() {
            break;
        }

        for contact in &batch {
            let key = (contact.address, contact.udp_port);
            queried_keys.insert(key);
            let mut payload = Vec::with_capacity(33);
            payload.push(KADEMLIA_FIND_VALUE);
            payload.extend_from_slice(target);
            payload.extend_from_slice(&contact.id);
            match send_kad(socket, contact, KADEMLIA2_REQ, &payload).await {
                Ok(()) => total_queried += 1,
                Err(error) => errors.push(error),
            }
        }

        let deadline = Instant::now() + LOOKUP_WAIT;
        while Instant::now() < deadline {
            let wait = deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(250));
            match recv_packet(socket, local_id, wait, &mut buffer).await {
                Ok(Some((source, opcode, payload))) => {
                    if opcode != KADEMLIA2_RES {
                        continue;
                    }
                    match parse_lookup_response(&payload, target) {
                        Ok(found) => {
                            response_keys.insert((*source.ip(), source.port()));
                            responsive.insert((*source.ip(), source.port()));
                            for contact in found {
                                let _ = upsert_contact(contacts, contact);
                            }
                        }
                        Err(error) => errors.push(format!(
                            "Kad lookup response from {source}: {error}"
                        )),
                    }
                }
                Ok(None) => {}
                Err(error) => errors.push(error),
            }
        }
    }

    (total_queried, response_keys.len(), errors)
}

async fn collect_keyword_results(
    socket: &UdpSocket,
    local_id: &[u8; 16],
    target: &[u8; 16],
    terms: &[String],
    contacts: &HashMap<(Ipv4Addr, u16), KadContact>,
) -> (usize, usize, Vec<NativeEd2kSearchResult>, Vec<String>) {
    let none = HashSet::new();
    // Kad keyword indexes live near the keyword target. Keep strict XOR
    // distance ordering here; liveness discovered during bootstrap/lookup is
    // useful for diagnostics but must not move a distant node ahead of a
    // closer candidate.
    let candidates = closest_contacts(
        contacts,
        target,
        KEYWORD_CONTACTS,
        3,
        &none,
    );

    let mut queried = 0usize;
    let mut errors = Vec::new();
    for contact in &candidates {
        let mut payload = Vec::with_capacity(18);
        payload.extend_from_slice(target);
        payload.extend_from_slice(&0u16.to_le_bytes());
        match send_kad(
            socket,
            contact,
            KADEMLIA2_SEARCH_KEY_REQ,
            &payload,
        )
        .await
        {
            Ok(()) => queried += 1,
            Err(error) => errors.push(error),
        }
    }

    let deadline = Instant::now() + KEYWORD_WAIT;
    let mut buffer = vec![0u8; MAX_KAD_DATAGRAM];
    let mut responders = HashSet::new();
    let mut results = Vec::new();

    while Instant::now() < deadline {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(350));
        match recv_packet(socket, local_id, wait, &mut buffer).await {
            Ok(Some((source, opcode, payload))) => {
                if opcode != KADEMLIA2_SEARCH_RES {
                    continue;
                }
                match parse_search_response(&payload, target, source, terms) {
                    Ok(mut found) => {
                        responders.insert((*source.ip(), source.port()));
                        results.append(&mut found);
                        if results.len() >= MAX_KAD_RESULTS {
                            results.truncate(MAX_KAD_RESULTS);
                            break;
                        }
                    }
                    Err(error) => errors.push(format!(
                        "Kad keyword response from {source}: {error}"
                    )),
                }
            }
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }

    (queried, responders.len(), results, errors)
}

fn source_search_payload(target: &[u8; 16], size: u64) -> Vec<u8> {
    let mut payload = Vec::with_capacity(26);
    payload.extend_from_slice(target);
    payload.extend_from_slice(&0u16.to_le_bytes());
    payload.extend_from_slice(&size.to_le_bytes());
    payload
}

async fn collect_source_results(
    socket: &UdpSocket,
    local_id: &[u8; 16],
    target: &[u8; 16],
    size: u64,
    contacts: &HashMap<(Ipv4Addr, u16), KadContact>,
) -> (usize, usize, Vec<NativeEd2kSource>, Vec<String>) {
    let none = HashSet::new();
    let candidates = closest_contacts(
        contacts,
        target,
        SOURCE_CONTACTS,
        2,
        &none,
    );

    let candidate_keys = candidates
        .iter()
        .map(|contact| (contact.address, contact.udp_port))
        .collect::<HashSet<_>>();
    let mut queried = 0usize;
    let mut errors = Vec::new();
    let payload = source_search_payload(target, size);
    for contact in &candidates {
        match send_kad(
            socket,
            contact,
            KADEMLIA2_SEARCH_SOURCE_REQ,
            &payload,
        )
        .await
        {
            Ok(()) => queried += 1,
            Err(error) => errors.push(error),
        }
    }

    let deadline = Instant::now() + SOURCE_WAIT;
    let mut buffer = vec![0u8; MAX_KAD_DATAGRAM];
    let mut responders = HashSet::new();
    let mut sources = Vec::new();

    while Instant::now() < deadline {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(350));
        match recv_packet(socket, local_id, wait, &mut buffer).await {
            Ok(Some((source, opcode, payload))) => {
                if opcode != KADEMLIA2_SEARCH_RES
                    || !candidate_keys.contains(&(*source.ip(), source.port()))
                {
                    continue;
                }
                match parse_source_response(&payload, target, size) {
                    Ok(mut found) => {
                        responders.insert((*source.ip(), source.port()));
                        sources.append(&mut found);
                        if sources.len() >= MAX_KAD_RESULTS {
                            sources.truncate(MAX_KAD_RESULTS);
                            break;
                        }
                    }
                    Err(error) => errors.push(format!(
                        "Kad source response from {source}: {error}"
                    )),
                }
            }
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }

    (queried, responders.len(), sources, errors)
}

pub(crate) async fn discover_sources_kad(
    app: &AppHandle,
    hash_be: &[u8; 16],
    size: u64,
) -> Result<KadSourceOutcome, String> {
    if size == 0 {
        return Err("Kad source discovery requires a non-zero file size.".to_string());
    }

    let target = file_target(hash_be);
    let (loaded, nodes_source) = load_nodes_dat(app).await?;
    let contacts_loaded = loaded.len();
    let local_id = make_local_kad_id();
    let mut contacts = contact_map(loaded);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|error| format!("Unable to bind Kad UDP socket: {error}"))?;

    let mut responsive = HashSet::new();
    let (bootstrap_queried, bootstrap_responded, mut errors) =
        collect_bootstrap(
            &socket,
            &local_id,
            &mut contacts,
            &mut responsive,
        )
        .await;

    let (lookup_queried, lookup_responded, lookup_errors) =
        collect_lookup(
            &socket,
            &local_id,
            &target,
            &mut contacts,
            &mut responsive,
        )
        .await;
    errors.extend(lookup_errors);

    let contacts_discovered = contacts.len().saturating_sub(contacts_loaded);
    let (
        source_queried,
        source_responded,
        sources,
        source_errors,
    ) = collect_source_results(
        &socket,
        &local_id,
        &target,
        size,
        &contacts,
    )
    .await;
    errors.extend(source_errors);

    if bootstrap_responded == 0
        && lookup_responded == 0
        && source_responded == 0
    {
        errors.push(
            "Kad contacts were loaded, but no Kad UDP node responded during source discovery."
                .to_string(),
        );
    }

    Ok(KadSourceOutcome {
        nodes_source,
        contacts_loaded,
        contacts_discovered,
        bootstrap_queried,
        bootstrap_responded,
        lookup_queried,
        lookup_responded,
        source_queried,
        source_responded,
        sources,
        errors,
    })
}

pub(crate) async fn search_kad(
    app: &AppHandle,
    query: &str,
) -> Result<KadSearchOutcome, String> {
    let (target, terms) = keyword_target(query)?;
    let (loaded, nodes_source) = load_nodes_dat(app).await?;
    let contacts_loaded = loaded.len();
    let local_id = make_local_kad_id();
    let mut contacts = contact_map(loaded);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|error| format!("Unable to bind Kad UDP socket: {error}"))?;

    let mut responsive = HashSet::new();
    let (bootstrap_queried, bootstrap_responded, mut errors) =
        collect_bootstrap(
            &socket,
            &local_id,
            &mut contacts,
            &mut responsive,
        )
        .await;

    let (lookup_queried, lookup_responded, lookup_errors) =
        collect_lookup(
            &socket,
            &local_id,
            &target,
            &mut contacts,
            &mut responsive,
        )
        .await;
    errors.extend(lookup_errors);

    let contacts_discovered = contacts.len().saturating_sub(contacts_loaded);
    let (
        keyword_queried,
        keyword_responded,
        results,
        keyword_errors,
    ) = collect_keyword_results(
        &socket,
        &local_id,
        &target,
        &terms,
        &contacts,
    )
    .await;
    errors.extend(keyword_errors);

    if bootstrap_responded == 0
        && lookup_responded == 0
        && keyword_responded == 0
    {
        errors.push(
            "Kad contacts were loaded, but no Kad UDP node responded."
                .to_string(),
        );
    }

    Ok(KadSearchOutcome {
        nodes_source,
        contacts_loaded,
        contacts_discovered,
        bootstrap_queried,
        bootstrap_responded,
        lookup_queried,
        lookup_responded,
        keyword_queried,
        keyword_responded,
        results,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_u16(buffer: &mut Vec<u8>, value: u16) {
        buffer.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(buffer: &mut Vec<u8>, value: u32) {
        buffer.extend_from_slice(&value.to_le_bytes());
    }

    fn push_string_tag(buffer: &mut Vec<u8>, name: u8, value: &str) {
        buffer.push(0x02);
        push_u16(buffer, 1);
        buffer.push(name);
        push_u16(buffer, value.len() as u16);
        buffer.extend_from_slice(value.as_bytes());
    }

    fn push_u32_tag(buffer: &mut Vec<u8>, name: u8, value: u32) {
        buffer.push(0x03);
        push_u16(buffer, 1);
        buffer.push(name);
        push_u32(buffer, value);
    }

    fn sample_contact(id_byte: u8) -> KadContact {
        KadContact {
            id: [id_byte; 16],
            address: Ipv4Addr::new(1, 2, 3, id_byte.max(1)),
            udp_port: 4672,
            tcp_port: 4662,
            version: 8,
            udp_key: 0,
            udp_key_ip: 0,
            verified: false,
        }
    }

    #[test]
    fn parses_bootstrap_nodes_dat_v3() {
        let mut data = Vec::new();
        push_u32(&mut data, 0);
        push_u32(&mut data, 3);
        push_u32(&mut data, 1);
        push_u32(&mut data, 1);
        data.extend_from_slice(&[0x11; 16]);
        push_u32(&mut data, u32::from_be_bytes([1, 2, 3, 4]));
        push_u16(&mut data, 4672);
        push_u16(&mut data, 4662);
        data.push(8);

        let contacts = parse_nodes_dat(&data).unwrap();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].address, Ipv4Addr::new(1, 2, 3, 4));
        assert_eq!(contacts[0].udp_port, 4672);
        assert_eq!(contacts[0].version, 8);
    }

    #[test]
    fn keyword_hash_matches_md4_vector() {
        let (wire, terms) = keyword_target("test history").unwrap();
        assert_eq!(terms[0], "test");
        assert_eq!(
            hash_hex(&wire_to_be(&wire)),
            "db346d691d7acc4dc2625db19f9e3f52"
        );
    }

    #[test]
    fn kad_nodeid_encryption_round_trips() {
        let local_id = sample_contact(0x33).id;
        let plain = kad_plain_packet(KADEMLIA2_REQ, &[1, 2, 3, 4]);
        let encrypted = encrypt_kad_packet(&plain, &local_id);
        assert_ne!(encrypted[0], OP_KADEMLIAHEADER);
        let decrypted = decrypt_kad_packet(&encrypted, &local_id).unwrap();
        assert_eq!(decrypted, plain);
    }

    #[test]
    fn parses_kad_lookup_contacts() {
        let target = [0x44; 16];
        let mut payload = Vec::new();
        payload.extend_from_slice(&target);
        payload.push(1);
        payload.extend_from_slice(&[0x55; 16]);
        push_u32(&mut payload, u32::from_be_bytes([8, 8, 8, 8]));
        push_u16(&mut payload, 4672);
        push_u16(&mut payload, 4662);
        payload.push(8);

        let contacts = parse_lookup_response(&payload, &target).unwrap();
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].address, Ipv4Addr::new(8, 8, 8, 8));
    }

    #[test]
    fn parses_kad_keyword_result_into_ed2k_identity() {
        let target = [0x66; 16];
        let answer = [0x77; 16];
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&answer);
        payload.push(3);
        push_string_tag(&mut payload, TAG_FILENAME, "history book.epub");
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(&mut payload, TAG_SOURCES, 9);

        let source = SocketAddrV4::new(Ipv4Addr::new(9, 9, 9, 9), 4672);
        let terms = vec!["history".to_string(), "book".to_string()];
        let results =
            parse_search_response(&payload, &target, source, &terms).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "history book.epub");
        assert_eq!(results[0].size, 12_345);
        assert_eq!(results[0].sources, 9);
        assert!(results[0].book_candidate);
        assert!(results[0].ed2k_link.starts_with("ed2k://|file|"));
    }

    #[test]
    fn file_hash_be_bytes_round_trip_to_kad_target() {
        let mut hash = [0u8; 16];
        for (index, byte) in hash.iter_mut().enumerate() {
            *byte = index as u8;
        }
        let target = file_target(&hash);
        assert_eq!(wire_to_be(&target), hash);
    }

    #[test]
    fn encodes_kad_source_request_target_start_and_size() {
        let hash = [0x21; 16];
        let target = file_target(&hash);
        let size = 0x0102_0304_0506_0708u64;
        let payload = source_search_payload(&target, size);

        assert_eq!(payload.len(), 26);
        assert_eq!(&payload[..16], &target);
        assert_eq!(&payload[16..18], &0u16.to_le_bytes());
        assert_eq!(&payload[18..26], &size.to_le_bytes());
    }

    #[test]
    fn parses_kad_high_id_source_result() {
        let hash = [0x42; 16];
        let target = file_target(&hash);
        let answer = [0x33; 16];
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x99; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&answer);
        payload.push(6);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 1);
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([8, 8, 4, 4]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);
        push_u32_tag(&mut payload, TAG_SOURCEUPORT, 4672);
        push_u32_tag(&mut payload, TAG_ENCRYPTION, 9);

        let sources = parse_source_response(&payload, &target, 12_345).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].address.as_deref(), Some("8.8.4.4"));
        assert_eq!(sources[0].tcp_port, 4662);
        assert_eq!(sources[0].udp_port, Some(4672));
        assert_eq!(sources[0].source_type, Some(1));
        assert_eq!(sources[0].encryption, Some(9));
        assert!(sources[0].direct);
        assert!(!sources[0].low_id);
        assert!(sources[0].source_id.is_some());
    }

    #[test]
    fn keeps_kad_firewalled_source_callback_metadata() {
        let hash = [0x52; 16];
        let target = file_target(&hash);
        let answer = [0x44; 16];
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&answer);
        payload.push(8);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 3);
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([9, 9, 9, 9]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);
        push_u32_tag(&mut payload, TAG_SOURCEUPORT, 4672);
        push_u32_tag(
            &mut payload,
            TAG_SERVERIP,
            u32::from_be_bytes([8, 8, 8, 8]),
        );
        push_u32_tag(&mut payload, TAG_SERVERPORT, 4672);
        push_string_tag(
            &mut payload,
            TAG_BUDDYHASH,
            "00112233445566778899AABBCCDDEEFF",
        );

        let sources = parse_source_response(&payload, &target, 12_345).unwrap();
        assert_eq!(sources.len(), 1);
        assert!(!sources[0].direct);
        assert!(sources[0].low_id);
        assert_eq!(sources[0].buddy_address.as_deref(), Some("8.8.8.8"));
        assert_eq!(sources[0].buddy_port, Some(4672));
        assert_eq!(
            sources[0].buddy_id.as_deref(),
            Some("00112233445566778899aabbccddeeff")
        );
    }

    #[test]
    fn rejects_kad_source_with_mismatched_published_size() {
        let hash = [0x72; 16];
        let target = file_target(&hash);
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&[0x65; 16]);
        payload.push(4);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 1);
        push_u32_tag(&mut payload, TAG_FILESIZE, 99_999);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([8, 8, 8, 8]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);

        assert!(parse_source_response(&payload, &target, 12_345)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_kad_source_without_tcp_port() {
        let hash = [0x82; 16];
        let target = file_target(&hash);
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&[0x75; 16]);
        payload.push(4);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 1);
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([8, 8, 8, 8]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 0);

        assert!(parse_source_response(&payload, &target, 12_345)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn accepts_large_kad_source_type_above_old_protocol_limit() {
        let hash = [0x91; 16];
        let target = file_target(&hash);
        let size = OLD_MAX_FILE_SIZE + 1;
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&[0x84; 16]);
        payload.push(3);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 4);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([8, 8, 8, 8]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);

        let sources = parse_source_response(&payload, &target, size).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].source_type, Some(4));
    }

    #[test]
    fn rejects_kad_source_type_for_wrong_file_size_class() {
        let hash = [0x92; 16];
        let target = file_target(&hash);
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&[0x85; 16]);
        payload.push(4);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 4);
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([8, 8, 8, 8]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);

        assert!(parse_source_response(&payload, &target, 12_345)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_private_kad_source_endpoints() {
        let hash = [0x62; 16];
        let target = file_target(&hash);
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0x88; 16]);
        payload.extend_from_slice(&target);
        push_u16(&mut payload, 1);
        payload.extend_from_slice(&[0x55; 16]);
        payload.push(4);
        push_u32_tag(&mut payload, TAG_SOURCETYPE, 1);
        push_u32_tag(&mut payload, TAG_FILESIZE, 12_345);
        push_u32_tag(
            &mut payload,
            TAG_SOURCEIP,
            u32::from_be_bytes([192, 168, 1, 20]),
        );
        push_u32_tag(&mut payload, TAG_SOURCEPORT, 4662);

        assert!(parse_source_response(&payload, &target, 12_345)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_private_kad_contact_addresses() {
        assert!(!valid_contact_address(
            Ipv4Addr::new(127, 0, 0, 1),
            4672,
        ));
        assert!(!valid_contact_address(
            Ipv4Addr::new(192, 168, 1, 10),
            4672,
        ));
        assert!(!valid_contact_address(
            Ipv4Addr::new(169, 254, 1, 10),
            4672,
        ));
        assert!(valid_contact_address(
            Ipv4Addr::new(8, 8, 8, 8),
            4672,
        ));
    }

    #[test]
    fn deduplicates_contacts_by_udp_endpoint() {
        let mut first = sample_contact(1);
        let mut second = first.clone();
        first.version = 5;
        second.version = 8;
        let mut contacts = vec![first, second];
        dedupe_contacts(&mut contacts);
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].version, 8);
    }
}

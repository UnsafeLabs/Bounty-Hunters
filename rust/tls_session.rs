use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Maximum number of cached sessions before eviction kicks in.
const MAX_CACHE_SIZE: usize = 4096;

/// Default ticket lifetime in seconds (2 hours).
const DEFAULT_TICKET_LIFETIME_SECS: u64 = 7200;

static NONCE_COUNTER: AtomicU64 = AtomicU64::new(1);

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum SessionError {
    TicketExpired { ticket_id: String },
    EncryptionFailed(String),
    DecryptionFailed(String),
    CacheFull,
    InvalidTicket(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::TicketExpired { ticket_id } => {
                write!(f, "session ticket expired: {}", ticket_id)
            }
            SessionError::EncryptionFailed(msg) => write!(f, "encryption failed: {}", msg),
            SessionError::DecryptionFailed(msg) => write!(f, "decryption failed: {}", msg),
            SessionError::CacheFull => write!(f, "session cache is full"),
            SessionError::InvalidTicket(msg) => write!(f, "invalid ticket: {}", msg),
        }
    }
}

impl std::error::Error for SessionError {}

// ---------------------------------------------------------------------------
// Core data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SessionTicket {
    pub ticket_id: String,
    pub cipher_suite: u16,
    pub master_secret: Vec<u8>,
    pub issued_at: u64,
    pub lifetime_secs: u64,
    pub encrypted_state: Vec<u8>,
    pub creation_time: u64,
}

#[derive(Debug, Clone)]
pub struct EncryptionKey {
    pub key_id: u32,
    pub key_material: Vec<u8>,
    pub created_at: u64,
}

#[derive(Debug, Clone)]
pub struct SessionCache {
    /// Thread-safe reference to the inner cache map.
    cache: Arc<RwLock<HashMap<String, SessionTicket>>>,
    encryption_key: EncryptionKey,
    max_size: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CipherSuite {
    TlsAes128GcmSha256 = 0x1301,
    TlsAes256GcmSha384 = 0x1302,
    TlsChacha20Poly1305Sha256 = 0x1303,
}

// ---------------------------------------------------------------------------
// EncryptionKey helpers
// ---------------------------------------------------------------------------

impl EncryptionKey {
    pub fn new(key_id: u32, material: Vec<u8>) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        EncryptionKey {
            key_id,
            key_material: material,
            created_at: now,
        }
    }
}

// ---------------------------------------------------------------------------
// SessionCache implementation
// ---------------------------------------------------------------------------

impl SessionCache {
    /// Create a new, empty session cache with a default encryption key.
    pub fn new(key_material: Vec<u8>) -> Self {
        let key = EncryptionKey::new(1, key_material);
        SessionCache {
            cache: Arc::new(RwLock::new(HashMap::new())),
            encryption_key: key,
            max_size: MAX_CACHE_SIZE,
        }
    }

    /// Store a session ticket in the cache.
    pub fn store_session(&self, ticket: SessionTicket) -> Result<(), SessionError> {
        let mut inner = self.cache.write().map_err(|_| {
            SessionError::InvalidTicket("session cache lock poisoned".to_string())
        })?;

        if inner.len() >= self.max_size {
            self.evict_expired_sessions(&mut inner);
        }

        if inner.len() >= self.max_size {
            return Err(SessionError::CacheFull);
        }

        inner.insert(ticket.ticket_id.clone(), ticket);
        Ok(())
    }

    /// Look up a session by ticket id.
    ///
    /// Returns the ticket if it exists **and** has not expired.
    pub fn get_session(&self, ticket_id: &str) -> Option<SessionTicket> {
        let inner = self.cache.read().ok()?;
        let ticket = inner.get(ticket_id)?;

        if self.is_ticket_expired(ticket) {
            return None;
        }

        Some(ticket.clone())
    }

    /// Remove a specific ticket from the cache.
    pub fn remove_session(&self, ticket_id: &str) -> Option<SessionTicket> {
        let mut inner = self.cache.write().ok()?;
        inner.remove(ticket_id)
    }

    /// Return the number of cached sessions.
    pub fn session_count(&self) -> usize {
        self.cache.read().map(|inner| inner.len()).unwrap_or(0)
    }

    // -- internal helpers ---------------------------------------------------

    /// Check whether a ticket has exceeded its lifetime.
    fn is_ticket_expired(&self, ticket: &SessionTicket) -> bool {
        let age = self.calculate_ticket_age(ticket);
        age > ticket.lifetime_secs
    }

    /// Calculate the age of a ticket in seconds.
    fn calculate_ticket_age(&self, ticket: &SessionTicket) -> u64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        now.saturating_sub(ticket.issued_at)
    }

    /// Evict all expired sessions from the map.
    fn evict_expired_sessions(&self, map: &mut HashMap<String, SessionTicket>) {
        let expired_keys: Vec<String> = map
            .iter()
            .filter(|(_, t)| self.is_ticket_expired(t))
            .map(|(k, _)| k.clone())
            .collect();

        for key in expired_keys {
            map.remove(&key);
        }
    }
}

// ---------------------------------------------------------------------------
// Ticket creation & encryption
// ---------------------------------------------------------------------------

impl SessionCache {
    /// Issue a new session ticket for the given cipher suite and secret.
    pub fn issue_ticket(
        &mut self,
        cipher_suite: CipherSuite,
        master_secret: Vec<u8>,
    ) -> Result<SessionTicket, SessionError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();

        let ticket_id = format!("tkt_{}_{}", self.encryption_key.key_id, now);

        let encrypted = self.encrypt_ticket(&master_secret)?;

        let ticket = SessionTicket {
            ticket_id,
            cipher_suite: cipher_suite as u16,
            master_secret,
            issued_at: now,
            lifetime_secs: DEFAULT_TICKET_LIFETIME_SECS,
            encrypted_state: encrypted,
            creation_time: now,
        };

        self.store_session(ticket.clone())?;
        Ok(ticket)
    }

    /// Encrypt ticket data using the current encryption key.
    ///
    /// In production this would call into a real AEAD cipher; here we
    /// use a simplified XOR-based placeholder.
    pub fn encrypt_ticket(&self, plaintext: &[u8]) -> Result<Vec<u8>, SessionError> {
        if self.encryption_key.key_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        let nonce = fresh_nonce();

        let key = &self.encryption_key.key_material;
        let mut ciphertext = Vec::with_capacity(nonce.len() + plaintext.len());
        ciphertext.extend_from_slice(&nonce);

        for (i, &byte) in plaintext.iter().enumerate() {
            let key_byte = key[i % key.len()];
            let nonce_byte = nonce[i % nonce.len()];
            ciphertext.push(byte ^ key_byte ^ nonce_byte);
        }

        Ok(ciphertext)
    }

    /// Decrypt ticket data using the current encryption key.
    pub fn decrypt_ticket(&self, ciphertext: &[u8]) -> Result<Vec<u8>, SessionError> {
        if ciphertext.len() < 12 {
            return Err(SessionError::DecryptionFailed(
                "ciphertext too short".to_string(),
            ));
        }
        if self.encryption_key.key_material.is_empty() {
            return Err(SessionError::DecryptionFailed(
                "empty key material".to_string(),
            ));
        }

        xor_crypt_ticket(ciphertext, &self.encryption_key.key_material)
            .map_err(SessionError::DecryptionFailed)
    }

    /// Rotate the ticket encryption key and re-encrypt cached tickets.
    pub fn rotate_key(&mut self, new_material: Vec<u8>) -> Result<(), SessionError> {
        if new_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        let old_key = self.encryption_key.clone();
        let new_key = EncryptionKey::new(old_key.key_id + 1, new_material);
        let mut inner = self.cache.write().map_err(|_| {
            SessionError::InvalidTicket("session cache lock poisoned".to_string())
        })?;

        for ticket in inner.values_mut() {
            let plaintext = xor_crypt_ticket(&ticket.encrypted_state, &old_key.key_material)
                .map_err(SessionError::DecryptionFailed)?;
            ticket.encrypted_state = encrypt_with_key(&plaintext, &new_key.key_material);
        }

        self.encryption_key = new_key;
        Ok(())
    }
}

fn fresh_nonce() -> [u8; 12] {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_nanos();
    let counter = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed) as u128;
    let mixed = now ^ counter.rotate_left(17) ^ ((std::process::id() as u128) << 32);
    let bytes = mixed.to_le_bytes();
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&bytes[..12]);
    nonce
}

fn encrypt_with_key(plaintext: &[u8], key: &[u8]) -> Vec<u8> {
    let nonce = fresh_nonce();
    let mut ciphertext = Vec::with_capacity(nonce.len() + plaintext.len());
    ciphertext.extend_from_slice(&nonce);
    for (i, &byte) in plaintext.iter().enumerate() {
        let key_byte = key[i % key.len()];
        let nonce_byte = nonce[i % nonce.len()];
        ciphertext.push(byte ^ key_byte ^ nonce_byte);
    }
    ciphertext
}

fn xor_crypt_ticket(ciphertext: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if ciphertext.len() < 12 {
        return Err("ciphertext too short".to_string());
    }
    if key.is_empty() {
        return Err("empty key material".to_string());
    }

    let nonce = &ciphertext[..12];
    let data = &ciphertext[12..];
    let mut plaintext = Vec::with_capacity(data.len());
    for (i, &byte) in data.iter().enumerate() {
        let key_byte = key[i % key.len()];
        let nonce_byte = nonce[i % nonce.len()];
        plaintext.push(byte ^ key_byte ^ nonce_byte);
    }
    Ok(plaintext)
}

// ---------------------------------------------------------------------------
// Display / summary helpers
// ---------------------------------------------------------------------------

impl std::fmt::Display for SessionTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "SessionTicket {{ id: {}, suite: 0x{:04x}, issued: {}, lifetime: {}s }}",
            self.ticket_id, self.cipher_suite, self.issued_at, self.lifetime_secs,
        )
    }
}

impl SessionCache {
    /// Return a summary line for logging / diagnostics.
    pub fn summary(&self) -> String {
        format!(
            "SessionCache {{ sessions: {}, key_id: {}, max: {} }}",
            self.session_count(),
            self.encryption_key.key_id,
            self.max_size,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn ticket(id: &str, issued_at: u64, lifetime_secs: u64) -> SessionTicket {
        SessionTicket {
            ticket_id: id.to_string(),
            cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
            master_secret: b"secret".to_vec(),
            issued_at,
            lifetime_secs,
            encrypted_state: Vec::new(),
            creation_time: issued_at,
        }
    }

    #[test]
    fn get_missing_session_returns_none() {
        let cache = SessionCache::new(b"key".to_vec());
        assert!(cache.get_session("missing").is_none());
    }

    #[test]
    fn get_session_filters_expired_tickets() {
        let cache = SessionCache::new(b"key".to_vec());
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        cache.store_session(ticket("fresh", now - 100, DEFAULT_TICKET_LIFETIME_SECS)).unwrap();
        cache.store_session(ticket("expired", now - 7201, DEFAULT_TICKET_LIFETIME_SECS)).unwrap();
        assert!(cache.get_session("fresh").is_some());
        assert!(cache.get_session("expired").is_none());
    }

    #[test]
    fn concurrent_store_and_lookup_is_synchronized() {
        let cache = Arc::new(SessionCache::new(b"key".to_vec()));
        let mut handles = Vec::new();
        for idx in 0..10 {
            let cache = Arc::clone(&cache);
            handles.push(thread::spawn(move || {
                let id = format!("tkt_{}", idx);
                cache.store_session(ticket(&id, 1, u64::MAX)).unwrap();
                assert!(cache.get_session(&id).is_some());
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(cache.session_count(), 10);
    }

    #[test]
    fn rotate_key_reencrypts_cached_tickets() {
        let mut cache = SessionCache::new(b"old-key".to_vec());
        let ticket = cache.issue_ticket(
            CipherSuite::TlsAes128GcmSha256,
            b"master-secret".to_vec(),
        ).unwrap();
        let old_encrypted = ticket.encrypted_state.clone();

        cache.rotate_key(b"new-key".to_vec()).unwrap();
        let rotated = cache.get_session(&ticket.ticket_id).unwrap();

        assert_eq!(cache.encryption_key.key_id, 2);
        assert_ne!(rotated.encrypted_state, old_encrypted);
        assert_eq!(cache.decrypt_ticket(&rotated.encrypted_state).unwrap(), b"master-secret");
    }

    #[test]
    fn encrypt_ticket_uses_fresh_nonce() {
        let cache = SessionCache::new(b"key".to_vec());
        let first = cache.encrypt_ticket(b"same_data").unwrap();
        let second = cache.encrypt_ticket(b"same_data").unwrap();
        assert_ne!(first, second);
        assert_eq!(cache.decrypt_ticket(&first).unwrap(), b"same_data");
        assert_eq!(cache.decrypt_ticket(&second).unwrap(), b"same_data");
    }
}

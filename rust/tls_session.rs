use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::io::Read;

/// Maximum number of cached sessions before eviction kicks in.
const MAX_CACHE_SIZE: usize = 4096;

/// Default ticket lifetime in seconds (2 hours).
const DEFAULT_TICKET_LIFETIME_SECS: u64 = 7200;

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
        EncryptionKey {
            key_id,
            key_material: material,
            created_at: current_unix_secs(),
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
        let mut inner = self
            .cache
            .write()
            .map_err(|_| SessionError::InvalidTicket("session cache lock poisoned".to_string()))?;

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
        current_unix_secs().saturating_sub(ticket.issued_at)
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
        &self,
        cipher_suite: CipherSuite,
        master_secret: Vec<u8>,
    ) -> Result<SessionTicket, SessionError> {
        let now = current_unix_secs();

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
        encrypt_with_key(&self.encryption_key.key_material, plaintext)
    }

    /// Decrypt ticket data using the current encryption key.
    pub fn decrypt_ticket(&self, ciphertext: &[u8]) -> Result<Vec<u8>, SessionError> {
        decrypt_with_key(&self.encryption_key.key_material, ciphertext)
    }

    /// Rotate the active ticket encryption key and re-encrypt cached sessions.
    pub fn rotate_key(&mut self, new_material: Vec<u8>) -> Result<(), SessionError> {
        if new_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        let old_key = self.encryption_key.clone();
        let new_key = EncryptionKey::new(old_key.key_id + 1, new_material);

        let mut inner = self
            .cache
            .write()
            .map_err(|_| SessionError::InvalidTicket("session cache lock poisoned".to_string()))?;

        let mut reencrypted = Vec::with_capacity(inner.len());
        for (ticket_id, ticket) in inner.iter() {
            let plaintext = decrypt_with_key(&old_key.key_material, &ticket.encrypted_state)?;
            let encrypted = encrypt_with_key(&new_key.key_material, &plaintext)?;
            reencrypted.push((ticket_id.clone(), encrypted));
        }

        for (ticket_id, encrypted_state) in reencrypted {
            if let Some(ticket) = inner.get_mut(&ticket_id) {
                ticket.encrypted_state = encrypted_state;
            }
        }

        self.encryption_key = new_key;
        Ok(())
    }
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
        let session_count = self.cache.read().map(|inner| inner.len()).unwrap_or(0);
        format!(
            "SessionCache {{ sessions: {}, key_id: {}, max: {} }}",
            session_count, self.encryption_key.key_id, self.max_size,
        )
    }
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn encrypt_with_key(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, SessionError> {
    if key.is_empty() {
        return Err(SessionError::EncryptionFailed(
            "empty key material".to_string(),
        ));
    }

    let mut nonce = [0u8; 12];
    fill_random_nonce(&mut nonce)?;

    let mut ciphertext = Vec::with_capacity(nonce.len() + plaintext.len());
    ciphertext.extend_from_slice(&nonce);

    for (i, &byte) in plaintext.iter().enumerate() {
        let key_byte = key[i % key.len()];
        let nonce_byte = nonce[i % nonce.len()];
        ciphertext.push(byte ^ key_byte ^ nonce_byte);
    }

    Ok(ciphertext)
}

fn decrypt_with_key(key: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, SessionError> {
    if key.is_empty() {
        return Err(SessionError::DecryptionFailed(
            "empty key material".to_string(),
        ));
    }

    if ciphertext.len() < 12 {
        return Err(SessionError::DecryptionFailed(
            "ciphertext too short".to_string(),
        ));
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

#[cfg(unix)]
fn fill_random_nonce(nonce: &mut [u8; 12]) -> Result<(), SessionError> {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(nonce))
        .map_err(|err| SessionError::EncryptionFailed(err.to_string()))
}

#[cfg(windows)]
fn fill_random_nonce(nonce: &mut [u8; 12]) -> Result<(), SessionError> {
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x00000002;

    #[link(name = "bcrypt")]
    extern "system" {
        fn BCryptGenRandom(
            h_algorithm: *mut std::ffi::c_void,
            pb_buffer: *mut u8,
            cb_buffer: u32,
            dw_flags: u32,
        ) -> i32;
    }

    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            nonce.as_mut_ptr(),
            nonce.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };

    if status >= 0 {
        Ok(())
    } else {
        Err(SessionError::EncryptionFailed(format!(
            "BCryptGenRandom failed with status {status}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    fn test_cache() -> SessionCache {
        SessionCache::new(b"test key material".to_vec())
    }

    fn test_ticket(
        cache: &SessionCache,
        ticket_id: &str,
        issued_at: u64,
        lifetime_secs: u64,
        secret: &[u8],
    ) -> SessionTicket {
        SessionTicket {
            ticket_id: ticket_id.to_string(),
            cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
            master_secret: secret.to_vec(),
            issued_at,
            lifetime_secs,
            encrypted_state: cache.encrypt_ticket(secret).unwrap(),
            creation_time: issued_at,
        }
    }

    #[test]
    fn get_session_returns_none_for_missing_ticket() {
        let cache = test_cache();

        assert!(cache.get_session("missing").is_none());
    }

    #[test]
    fn get_session_returns_existing_unexpired_ticket() {
        let cache = test_cache();
        let now = current_unix_secs();
        let ticket = test_ticket(
            &cache,
            "tkt_1_present",
            now,
            DEFAULT_TICKET_LIFETIME_SECS,
            b"secret",
        );

        cache.store_session(ticket).unwrap();
        let found = cache.get_session("tkt_1_present").unwrap();

        assert_eq!(found.ticket_id, "tkt_1_present");
    }

    #[test]
    fn get_session_returns_none_for_expired_ticket() {
        let cache = test_cache();
        let now = current_unix_secs();
        let ticket = test_ticket(
            &cache,
            "tkt_1_expired",
            now.saturating_sub(DEFAULT_TICKET_LIFETIME_SECS + 1),
            DEFAULT_TICKET_LIFETIME_SECS,
            b"secret",
        );

        cache.store_session(ticket).unwrap();

        assert!(cache.get_session("tkt_1_expired").is_none());
    }

    #[test]
    fn concurrent_store_and_get_complete_without_panics() {
        let cache = Arc::new(test_cache());
        let mut handles = Vec::new();

        for idx in 0..10 {
            let cache = Arc::clone(&cache);
            handles.push(thread::spawn(move || {
                let ticket_id = format!("tkt_thread_{idx}");
                let secret = format!("secret-{idx}");
                let ticket = test_ticket(
                    &cache,
                    &ticket_id,
                    current_unix_secs(),
                    DEFAULT_TICKET_LIFETIME_SECS,
                    secret.as_bytes(),
                );

                cache.store_session(ticket).unwrap();
                let found = cache.get_session(&ticket_id).unwrap();
                assert_eq!(found.ticket_id, ticket_id);
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(cache.session_count(), 10);
    }

    #[test]
    fn rotate_key_reencrypts_cached_tickets_with_incremented_key_id() {
        let mut cache = test_cache();
        let ticket = cache
            .issue_ticket(CipherSuite::TlsAes128GcmSha256, b"master secret".to_vec())
            .unwrap();
        let old_key_id = cache.encryption_key.key_id;
        let old_encrypted_state = ticket.encrypted_state.clone();

        cache.rotate_key(b"new key material".to_vec()).unwrap();

        assert_eq!(cache.encryption_key.key_id, old_key_id + 1);
        let rotated = cache.get_session(&ticket.ticket_id).unwrap();
        assert_ne!(rotated.encrypted_state, old_encrypted_state);
        assert_eq!(
            cache.decrypt_ticket(&rotated.encrypted_state).unwrap(),
            ticket.master_secret
        );
    }

    #[test]
    fn rotate_key_succeeds_on_empty_cache() {
        let mut cache = test_cache();
        let old_key_id = cache.encryption_key.key_id;

        cache.rotate_key(b"new key material".to_vec()).unwrap();

        assert_eq!(cache.encryption_key.key_id, old_key_id + 1);
        assert_eq!(cache.session_count(), 0);
    }

    #[test]
    fn calculate_ticket_age_uses_current_time_minus_issued_at() {
        let cache = test_cache();
        let now = current_unix_secs();
        let expired = test_ticket(
            &cache,
            "expired",
            now.saturating_sub(DEFAULT_TICKET_LIFETIME_SECS + 1),
            DEFAULT_TICKET_LIFETIME_SECS,
            b"expired",
        );
        let fresh = test_ticket(
            &cache,
            "fresh",
            now.saturating_sub(100),
            DEFAULT_TICKET_LIFETIME_SECS,
            b"fresh",
        );

        assert!(cache.calculate_ticket_age(&expired) >= DEFAULT_TICKET_LIFETIME_SECS + 1);
        assert!(cache.is_ticket_expired(&expired));
        assert!(!cache.is_ticket_expired(&fresh));
    }

    #[test]
    fn encrypt_ticket_uses_fresh_nonce_and_round_trips() {
        let cache = test_cache();
        let plaintext = b"same_data";

        let first = cache.encrypt_ticket(plaintext).unwrap();
        let second = cache.encrypt_ticket(plaintext).unwrap();

        assert_ne!(first, second);
        assert_ne!(&first[..12], &second[..12]);
        assert_eq!(cache.decrypt_ticket(&first).unwrap(), plaintext);
        assert_eq!(cache.decrypt_ticket(&second).unwrap(), plaintext);
    }
}

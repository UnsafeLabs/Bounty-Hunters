use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
        let ticket = {
            let inner = self.cache.read().ok()?;
            inner.get(ticket_id).cloned()?
        };

        if self.is_ticket_expired(&ticket) {
            return None;
        }

        Some(ticket)
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
        current_timestamp().saturating_sub(ticket.issued_at)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn ticket(ticket_id: &str, issued_at: u64, lifetime_secs: u64) -> SessionTicket {
        let cache = SessionCache::new(b"test-key".to_vec());
        SessionTicket {
            ticket_id: ticket_id.to_string(),
            cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
            master_secret: b"master-secret".to_vec(),
            issued_at,
            lifetime_secs,
            encrypted_state: cache.encrypt_ticket(b"master-secret").unwrap(),
            creation_time: issued_at,
        }
    }

    #[test]
    fn missing_ticket_returns_none() {
        let cache = SessionCache::new(b"test-key".to_vec());

        assert!(cache.get_session("does-not-exist").is_none());
    }

    #[test]
    fn valid_ticket_is_returned() {
        let cache = SessionCache::new(b"test-key".to_vec());
        let stored = ticket("tkt_1_12345", current_timestamp(), DEFAULT_TICKET_LIFETIME_SECS);

        cache.store_session(stored).unwrap();

        assert!(cache.get_session("tkt_1_12345").is_some());
    }

    #[test]
    fn expired_ticket_returns_none() {
        let cache = SessionCache::new(b"test-key".to_vec());
        let issued_at = current_timestamp().saturating_sub(DEFAULT_TICKET_LIFETIME_SECS + 1);
        let stored = ticket("expired", issued_at, DEFAULT_TICKET_LIFETIME_SECS);

        cache.store_session(stored).unwrap();

        assert!(cache.get_session("expired").is_none());
    }

    #[test]
    fn concurrent_store_and_get_completes() {
        let cache = Arc::new(SessionCache::new(b"test-key".to_vec()));
        let mut handles = Vec::new();

        for idx in 0..10 {
            let cache = Arc::clone(&cache);
            handles.push(thread::spawn(move || {
                let id = format!("ticket-{idx}");
                let stored = ticket(&id, current_timestamp(), DEFAULT_TICKET_LIFETIME_SECS);
                cache.store_session(stored).unwrap();
                assert!(cache.get_session(&id).is_some());
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }
    }

    #[test]
    fn calculate_ticket_age_uses_current_time() {
        let cache = SessionCache::new(b"test-key".to_vec());
        let old_ticket = ticket(
            "old",
            current_timestamp().saturating_sub(DEFAULT_TICKET_LIFETIME_SECS + 1),
            DEFAULT_TICKET_LIFETIME_SECS,
        );
        let fresh_ticket = ticket(
            "fresh",
            current_timestamp().saturating_sub(100),
            DEFAULT_TICKET_LIFETIME_SECS,
        );

        assert!(cache.is_ticket_expired(&old_ticket));
        assert!(!cache.is_ticket_expired(&fresh_ticket));
    }

    #[test]
    fn rotate_key_reencrypts_cached_tickets() {
        let mut cache = SessionCache::new(b"old-key".to_vec());
        let mut stored = ticket("rotated", current_timestamp(), DEFAULT_TICKET_LIFETIME_SECS);
        let original_secret = stored.master_secret.clone();
        stored.encrypted_state = cache.encrypt_ticket(&original_secret).unwrap();
        cache.store_session(stored.clone()).unwrap();

        cache.rotate_key(b"new-key".to_vec()).unwrap();

        assert_eq!(cache.encryption_key.key_id, 2);
        let rotated = cache.get_session("rotated").unwrap();
        assert_eq!(
            cache.decrypt_ticket(&rotated.encrypted_state).unwrap(),
            original_secret
        );
    }

    #[test]
    fn rotate_key_on_empty_cache_succeeds() {
        let mut cache = SessionCache::new(b"old-key".to_vec());

        cache.rotate_key(b"new-key".to_vec()).unwrap();

        assert_eq!(cache.encryption_key.key_id, 2);
        assert_eq!(cache.session_count(), 0);
    }

    #[test]
    fn encrypt_ticket_uses_fresh_nonce_and_round_trips() {
        let cache = SessionCache::new(b"test-key".to_vec());

        let first = cache.encrypt_ticket(b"same-data").unwrap();
        let second = cache.encrypt_ticket(b"same-data").unwrap();

        assert_ne!(first, second);
        assert_eq!(cache.decrypt_ticket(&first).unwrap(), b"same-data");
        assert_eq!(cache.decrypt_ticket(&second).unwrap(), b"same-data");
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
        encrypt_with_key(&self.encryption_key.key_material, plaintext)
    }

    /// Decrypt ticket data using the current encryption key.
    pub fn decrypt_ticket(&self, ciphertext: &[u8]) -> Result<Vec<u8>, SessionError> {
        decrypt_with_key(&self.encryption_key.key_material, ciphertext)
    }

    /// Rotate the encryption key and re-encrypt all cached tickets.
    pub fn rotate_key(&mut self, new_material: Vec<u8>) -> Result<(), SessionError> {
        if new_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        let old_key_material = self.encryption_key.key_material.clone();
        let new_key = EncryptionKey::new(self.encryption_key.key_id + 1, new_material);

        {
            let mut inner = self.cache.write().map_err(|_| {
                SessionError::InvalidTicket("session cache lock poisoned".to_string())
            })?;

            for ticket in inner.values_mut() {
                let plaintext = decrypt_with_key(&old_key_material, &ticket.encrypted_state)?;
                ticket.encrypted_state = encrypt_with_key(&new_key.key_material, &plaintext)?;
            }
        }

        self.encryption_key = new_key;
        Ok(())
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn random_nonce() -> Result<[u8; 12], SessionError> {
    let mut nonce = [0u8; 12];
    let mut file = File::open("/dev/urandom")
        .map_err(|error| SessionError::EncryptionFailed(error.to_string()))?;
    file.read_exact(&mut nonce)
        .map_err(|error| SessionError::EncryptionFailed(error.to_string()))?;
    Ok(nonce)
}

fn encrypt_with_key(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, SessionError> {
    if key.is_empty() {
        return Err(SessionError::EncryptionFailed(
            "empty key material".to_string(),
        ));
    }

    let nonce = random_nonce()?;
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

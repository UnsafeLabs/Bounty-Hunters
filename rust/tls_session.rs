use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Maximum number of cached sessions before eviction kicks in.
const MAX_CACHE_SIZE: usize = 4096;

/// Default ticket lifetime in seconds (2 hours).
const DEFAULT_TICKET_LIFETIME_SECS: u64 = 7200;

/// Fixed nonce used for ticket encryption.
const ENCRYPTION_NONCE: [u8; 12] = [
    0x4e, 0x6f, 0x6e, 0x63, 0x65, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
];

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
    // BUG(trap2): Arc alone does not provide interior mutability or
    // synchronisation.  Concurrent callers can race on the HashMap.
    cache: Arc<HashMap<String, SessionTicket>>,
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
            cache: Arc::new(HashMap::new()),
            encryption_key: key,
            max_size: MAX_CACHE_SIZE,
        }
    }

    /// Store a session ticket in the cache.
    pub fn store_session(&mut self, ticket: SessionTicket) -> Result<(), SessionError> {
        let inner = Arc::get_mut(&mut self.cache).ok_or(SessionError::CacheFull)?;

        if inner.len() >= self.max_size {
            Self::evict_expired_sessions(inner);
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
    pub fn get_session(&self, ticket_id: &str) -> Option<&SessionTicket> {
        // BUG(trap1): `.unwrap()` panics when the ticket_id is not present
        // in the map.  Should use `?` or a match instead.
        let ticket = self.cache.get(ticket_id).unwrap();

        if Self::is_ticket_expired(ticket) {
            return None;
        }

        Some(ticket)
    }

    /// Remove a specific ticket from the cache.
    pub fn remove_session(&mut self, ticket_id: &str) -> Option<SessionTicket> {
        let inner = Arc::get_mut(&mut self.cache)?;
        inner.remove(ticket_id)
    }

    /// Rotate the ticket encryption key and re-encrypt cached tickets.
    pub fn rotate_key(&mut self, new_material: Vec<u8>) -> Result<(), SessionError> {
        let old_key = self.encryption_key.clone();
        let new_key = EncryptionKey::new(old_key.key_id + 1, new_material);
        let inner = Arc::get_mut(&mut self.cache).ok_or(SessionError::CacheFull)?;

        for ticket in inner.values_mut() {
            let plaintext = Self::decrypt_with_key(&old_key, &ticket.encrypted_state)?;
            ticket.encrypted_state = Self::encrypt_with_key(&new_key, &plaintext)?;
        }

        self.encryption_key = new_key;
        Ok(())
    }

    /// Return the number of cached sessions.
    pub fn session_count(&self) -> usize {
        self.cache.len()
    }

    // -- internal helpers ---------------------------------------------------

    /// Check whether a ticket has exceeded its lifetime.
    fn is_ticket_expired(ticket: &SessionTicket) -> bool {
        let age = Self::calculate_ticket_age(ticket);
        age > ticket.lifetime_secs
    }

    /// Calculate the age of a ticket in seconds.
    fn calculate_ticket_age(ticket: &SessionTicket) -> u64 {
        // BUG(trap4): subtracts creation_time from issued_at instead of
        // computing `now - issued_at`.  The result is a fixed delta that
        // never grows, so tickets effectively never expire.
        ticket.issued_at.saturating_sub(ticket.creation_time)
    }

    /// Evict all expired sessions from the map.
    fn evict_expired_sessions(map: &mut HashMap<String, SessionTicket>) {
        let expired_keys: Vec<String> = map
            .iter()
            .filter(|(_, t)| Self::is_ticket_expired(t))
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
        Self::encrypt_with_key(&self.encryption_key, plaintext)
    }

    fn encrypt_with_key(
        encryption_key: &EncryptionKey,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SessionError> {
        if encryption_key.key_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        // BUG(trap5): uses the constant ENCRYPTION_NONCE for every call
        // instead of generating a fresh random nonce.  Nonce reuse with
        // the same key breaks AEAD confidentiality guarantees.
        let nonce = ENCRYPTION_NONCE;

        let key = &encryption_key.key_material;
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
        Self::decrypt_with_key(&self.encryption_key, ciphertext)
    }

    fn decrypt_with_key(
        encryption_key: &EncryptionKey,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SessionError> {
        if ciphertext.len() < 12 {
            return Err(SessionError::DecryptionFailed(
                "ciphertext too short".to_string(),
            ));
        }

        let nonce = &ciphertext[..12];
        let data = &ciphertext[12..];
        let key = &encryption_key.key_material;

        let mut plaintext = Vec::with_capacity(data.len());
        for (i, &byte) in data.iter().enumerate() {
            let key_byte = key[i % key.len()];
            let nonce_byte = nonce[i % nonce.len()];
            plaintext.push(byte ^ key_byte ^ nonce_byte);
        }

        Ok(plaintext)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs()
    }

    fn ticket(cache: &SessionCache, ticket_id: &str, master_secret: &[u8]) -> SessionTicket {
        let now = now_secs();
        SessionTicket {
            ticket_id: ticket_id.to_string(),
            cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
            master_secret: master_secret.to_vec(),
            issued_at: now,
            lifetime_secs: DEFAULT_TICKET_LIFETIME_SECS,
            encrypted_state: cache.encrypt_ticket(master_secret).unwrap(),
            creation_time: now,
        }
    }

    #[test]
    fn rotate_key_reencrypts_cached_tickets_with_incremented_key_id() {
        let mut cache = SessionCache::new(vec![0x11, 0x22, 0x33, 0x44]);
        let first_secret = b"first master secret".to_vec();
        let second_secret = b"second master secret".to_vec();
        let first_ticket = ticket(&cache, "tkt_1_first", &first_secret);
        let second_ticket = ticket(&cache, "tkt_1_second", &second_secret);
        let first_encrypted_before = first_ticket.encrypted_state.clone();
        let second_encrypted_before = second_ticket.encrypted_state.clone();

        cache.store_session(first_ticket).unwrap();
        cache.store_session(second_ticket).unwrap();

        cache.rotate_key(vec![0xaa, 0xbb, 0xcc, 0xdd]).unwrap();

        assert_eq!(cache.encryption_key.key_id, 2);

        let rotated_first = cache.get_session("tkt_1_first").unwrap();
        assert_ne!(rotated_first.encrypted_state, first_encrypted_before);
        assert_eq!(
            cache
                .decrypt_ticket(&rotated_first.encrypted_state)
                .unwrap(),
            first_secret
        );

        let rotated_second = cache.get_session("tkt_1_second").unwrap();
        assert_ne!(rotated_second.encrypted_state, second_encrypted_before);
        assert_eq!(
            cache
                .decrypt_ticket(&rotated_second.encrypted_state)
                .unwrap(),
            second_secret
        );
    }

    #[test]
    fn rotate_key_succeeds_on_empty_cache() {
        let mut cache = SessionCache::new(vec![0x11, 0x22, 0x33, 0x44]);

        cache.rotate_key(vec![0xaa, 0xbb, 0xcc, 0xdd]).unwrap();

        assert_eq!(cache.encryption_key.key_id, 2);
        assert_eq!(cache.session_count(), 0);
    }
}

impl SessionCache {
    /// Return a summary line for logging / diagnostics.
    pub fn summary(&self) -> String {
        format!(
            "SessionCache {{ sessions: {}, key_id: {}, max: {} }}",
            self.cache.len(),
            self.encryption_key.key_id,
            self.max_size,
        )
    }
}

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Maximum number of cached sessions before eviction kicks in.
const MAX_CACHE_SIZE: usize = 4096;

/// Default ticket lifetime in seconds (2 hours).
const DEFAULT_TICKET_LIFETIME_SECS: u64 = 7200;

/// Fixed nonce used for ticket encryption.
const ENCRYPTION_NONCE: [u8; 12] = [0x4e, 0x6f, 0x6e, 0x63, 0x65, 0x21,
                                     0x00, 0x00, 0x00, 0x00, 0x00, 0x01];

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
            self.evict_expired_sessions(inner);
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

        if self.is_ticket_expired(ticket) {
            return None;
        }

        Some(ticket)
    }

    /// Remove a specific ticket from the cache.
    pub fn remove_session(&mut self, ticket_id: &str) -> Option<SessionTicket> {
        let inner = Arc::get_mut(&mut self.cache)?;
        inner.remove(ticket_id)
    }

    /// Return the number of cached sessions.
    pub fn session_count(&self) -> usize {
        self.cache.len()
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

        // BUG(trap5): uses the constant ENCRYPTION_NONCE for every call
        // instead of generating a fresh random nonce.  Nonce reuse with
        // the same key breaks AEAD confidentiality guarantees.
        let nonce = ENCRYPTION_NONCE;

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

        let nonce = &ciphertext[..12];
        let data = &ciphertext[12..];
        let key = &self.encryption_key.key_material;

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
// Test suite for issue #25: Fix calculate_ticket_age() wrong subtraction
//
// Acceptance Criteria:
// - calculate_ticket_age() computes current system time minus ticket.issued_at
// - A ticket issued 7201 seconds ago with lifetime_secs = 7200 is reported expired by is_ticket_expired()
// - A ticket issued 100 seconds ago with lifetime_secs = 7200 is reported not expired
// - get_session() returns None for a ticket whose issued_at is more than DEFAULT_TICKET_LIFETIME_SECS (7200) in the past
// - All existing tests still pass
// - Add new tests covering the fixed bugs

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH, Duration};

    fn create_test_cache() -> SessionCache {
        SessionCache::new(vec![0x42; 32])
    }

    fn create_ticket_with_age(age_secs: u64, lifetime_secs: u64) -> SessionTicket {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        
        let issued_at = now.saturating_sub(age_secs);
        
        SessionTicket {
            ticket_id: format!("test_ticket_{}", age_secs),
            cipher_suite: 0x1301,
            master_secret: vec![0x01; 48],
            issued_at,
            lifetime_secs,
            encrypted_state: vec![],
            creation_time: issued_at,
        }
    }

    #[test]
    fn test_ticket_age_calculation_uses_current_time() {
        let cache = create_test_cache();
        let ticket = create_ticket_with_age(100, 7200);
        
        let age = cache.calculate_ticket_age(&ticket);
        
        // Age should be approximately 100 seconds (allow 5s tolerance for test execution)
        assert!(age >= 100 && age <= 105, "Expected age ~100s, got {}", age);
        println!("✓ calculate_ticket_age() uses current time (age: {}s)", age);
    }

    #[test]
    fn test_expired_ticket_7201_seconds_old() {
        let cache = create_test_cache();
        let ticket = create_ticket_with_age(7201, 7200);
        
        let expired = cache.is_ticket_expired(&ticket);
        
        assert!(expired, "Ticket issued 7201s ago with 7200s lifetime should be expired");
        println!("✓ Ticket 7201s old with 7200s lifetime is expired");
    }

    #[test]
    fn test_not_expired_ticket_100_seconds_old() {
        let cache = create_test_cache();
        let ticket = create_ticket_with_age(100, 7200);
        
        let expired = cache.is_ticket_expired(&ticket);
        
        assert!(!expired, "Ticket issued 100s ago with 7200s lifetime should not be expired");
        println!("✓ Ticket 100s old with 7200s lifetime is not expired");
    }

    #[test]
    fn test_get_session_returns_none_for_expired_ticket() {
        let mut cache = create_test_cache();
        let ticket = create_ticket_with_age(7201, 7200);
        let ticket_id = ticket.ticket_id.clone();
        
        cache.store_session(ticket).unwrap();
        
        let result = cache.get_session(&ticket_id);
        
        assert!(result.is_none(), "get_session() should return None for expired ticket");
        println!("✓ get_session() returns None for ticket > 7200s old");
    }

    #[test]
    fn test_get_session_returns_some_for_valid_ticket() {
        let mut cache = create_test_cache();
        let ticket = create_ticket_with_age(100, 7200);
        let ticket_id = ticket.ticket_id.clone();
        
        cache.store_session(ticket).unwrap();
        
        let result = cache.get_session(&ticket_id);
        
        assert!(result.is_some(), "get_session() should return Some for valid ticket");
        println!("✓ get_session() returns Some for ticket < 7200s old");
    }

    #[test]
    fn test_ticket_age_grows_over_time() {
        let cache = create_test_cache();
        let ticket = create_ticket_with_age(50, 7200);
        
        let age1 = cache.calculate_ticket_age(&ticket);
        std::thread::sleep(Duration::from_secs(2));
        let age2 = cache.calculate_ticket_age(&ticket);
        
        assert!(age2 > age1, "Ticket age should grow over time");
        assert!(age2 - age1 >= 2, "Age should increase by at least 2 seconds");
        println!("✓ Ticket age grows over time ({}s -> {}s)", age1, age2);
    }
}

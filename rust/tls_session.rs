use std::collections::HashMap;
use std::sync::{Arc, RwLock};
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
    pub fn store_session(&mut self, ticket: SessionTicket) -> Result<(), SessionError> {
        let mut inner = self.cache
            .write()
            .map_err(|_| SessionError::InvalidTicket("cache lock poisoned".to_string()))?;

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
    pub fn remove_session(&mut self, ticket_id: &str) -> Option<SessionTicket> {
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
        // BUG(trap4): subtracts creation_time from issued_at instead of
        // computing `now - issued_at`.  The result is a fixed delta that
        // never grows, so tickets effectively never expire.
        ticket.issued_at.saturating_sub(ticket.creation_time)
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
            self.session_count(),
            self.encryption_key.key_id,
            self.max_size,
        )
    }
}

#[cfg(test)]
mod test_issue_23 {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    fn create_test_cache() -> SessionCache {
        SessionCache::new(vec![0x42; 32])
    }

    #[test]
    fn test_concurrent_store_and_get() {
        let cache = Arc::new(std::sync::Mutex::new(create_test_cache()));
        let mut handles = vec![];

        // Spawn 10 threads that each store and get sessions
        for i in 0..10 {
            let cache_clone = Arc::clone(&cache);
            let handle = thread::spawn(move || {
                let mut cache = cache_clone.lock().unwrap();
                
                let ticket = SessionTicket {
                    ticket_id: format!("ticket_{}", i),
                    cipher_suite: 0x1301,
                    master_secret: vec![0x01; 48],
                    issued_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or(Duration::ZERO)
                        .as_secs(),
                    lifetime_secs: 7200,
                    encrypted_state: vec![],
                    creation_time: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or(Duration::ZERO)
                        .as_secs(),
                };
                
                cache.store_session(ticket).unwrap();
                
                let retrieved = cache.get_session(&format!("ticket_{}", i));
                assert!(retrieved.is_some(), "Thread {} failed to retrieve ticket", i);
            });
            handles.push(handle);
        }

        // Wait for all threads to complete
        for handle in handles {
            handle.join().unwrap();
        }

        let cache = cache.lock().unwrap();
        assert_eq!(cache.session_count(), 10);
        println!("✓ 10 threads calling store_session() and get_session() completed without panics");
    }

    #[test]
    fn test_concurrent_reads() {
        let mut cache = create_test_cache();
        
        // Store a ticket first
        let ticket = SessionTicket {
            ticket_id: "shared_ticket".to_string(),
            cipher_suite: 0x1301,
            master_secret: vec![0x01; 48],
            issued_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_secs(),
            lifetime_secs: 7200,
            encrypted_state: vec![],
            creation_time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_secs(),
        };
        cache.store_session(ticket).unwrap();
        
        let cache = Arc::new(cache);
        let mut handles = vec![];

        // Spawn 10 threads that all read the same ticket
        for i in 0..10 {
            let cache_clone = Arc::clone(&cache);
            let handle = thread::spawn(move || {
                let retrieved = cache_clone.get_session("shared_ticket");
                assert!(retrieved.is_some(), "Thread {} failed to read ticket", i);
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        println!("✓ Multiple concurrent readers can access the same ticket");
    }

    #[test]
    fn test_rwlock_allows_concurrent_reads() {
        let cache = Arc::new(create_test_cache());
        
        // RwLock should allow multiple concurrent read locks
        let read1 = cache.cache.read().unwrap();
        let read2 = cache.cache.read().unwrap();
        
        assert_eq!(read1.len(), 0);
        assert_eq!(read2.len(), 0);
        
        drop(read1);
        drop(read2);
        
        println!("✓ RwLock allows multiple concurrent read locks");
    }
}

// Spanish comment translation of rust/tls_session.rs. Code is unchanged; comments are localized.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// / Número máximo de sesiones almacenadas en caché antes de que se active el desalojo.
const MAX_CACHE_SIZE: usize = 4096;

// / Duración del ticket predeterminada en segundos (2 horas).
const DEFAULT_TICKET_LIFETIME_SECS: u64 = 7200;

// / Se corrigió el nonce utilizado para el cifrado de tickets.
const ENCRYPTION_NONCE: [u8; 12] = [0x4e, 0x6f, 0x6e, 0x63, 0x65, 0x21,
                                     0x00, 0x00, 0x00, 0x00, 0x00, 0x01];

// ---------------------------------------------------------------------
// Tipos de errores
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Estructuras de datos centrales
// ---------------------------------------------------------------------

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
    // / Referencia segura para subprocesos al mapa de caché interno.
    // ERROR (trampa2): El arco por sí solo no proporciona mutabilidad interior o
    // sincronización.  Las personas que llaman simultáneamente pueden competir en HashMap.
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

// ---------------------------------------------------------------------
// Ayudantes de EncryptionKey
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Implementación de SessionCache
// ---------------------------------------------------------------------

impl SessionCache {
    // / Cree una caché de sesión nueva y vacía con una clave de cifrado predeterminada.
    pub fn new(key_material: Vec<u8>) -> Self {
        let key = EncryptionKey::new(1, key_material);
        SessionCache {
            cache: Arc::new(HashMap::new()),
            encryption_key: key,
            max_size: MAX_CACHE_SIZE,
        }
    }

    // / Almacenar un ticket de sesión en el caché.
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

    // / Buscar una sesión por ID de ticket.
    // /
    // / Devuelve el ticket si existe **y** no ha caducado.
    pub fn get_session(&self, ticket_id: &str) -> Option<&SessionTicket> {
        // ERROR (trap1): `.unwrap()` entra en pánico cuando el ticket_id no está presente
        // en el mapa.  Debería usar `?` o una coincidencia en su lugar.
        let ticket = self.cache.get(ticket_id).unwrap();

        if self.is_ticket_expired(ticket) {
            return None;
        }

        Some(ticket)
    }

    // / Eliminar un ticket específico del caché.
    pub fn remove_session(&mut self, ticket_id: &str) -> Option<SessionTicket> {
        let inner = Arc::get_mut(&mut self.cache)?;
        inner.remove(ticket_id)
    }

    // / Devuelve el número de sesiones almacenadas en caché.
    pub fn session_count(&self) -> usize {
        self.cache.len()
    }

    // -- ayudantes internos ---------------------------------------------------

    // / Comprobar si un ticket ha superado su vida útil.
    fn is_ticket_expired(&self, ticket: &SessionTicket) -> bool {
        let age = self.calculate_ticket_age(ticket);
        age > ticket.lifetime_secs
    }

    // / Calcular la antigüedad de un billete en segundos.
    fn calculate_ticket_age(&self, ticket: &SessionTicket) -> u64 {
        // ERROR (trap4): resta tiempo_creación de emitido_at en lugar de
        // informática `ahora - emitido_en`.  El resultado es un delta fijo que
        // nunca crece, por lo que los boletos efectivamente nunca caducan.
        ticket.issued_at.saturating_sub(ticket.creation_time)
    }

    // / Desaloja todas las sesiones caducadas del mapa.
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

// ---------------------------------------------------------------------
// Creación y cifrado de tickets
// ---------------------------------------------------------------------

impl SessionCache {
    // / Emitir un nuevo ticket de sesión para el conjunto de cifrado y el secreto dados.
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

    // / Cifrar los datos del ticket utilizando la clave de cifrado actual.
    // /
    // / En producción, esto llamaría a un cifrado AEAD real; aquí nosotros
    // /Utilizo un marcador de posición simplificado basado en XOR.
    pub fn encrypt_ticket(&self, plaintext: &[u8]) -> Result<Vec<u8>, SessionError> {
        if self.encryption_key.key_material.is_empty() {
            return Err(SessionError::EncryptionFailed(
                "empty key material".to_string(),
            ));
        }

        // ERROR (trap5): utiliza la constante ENCRYPTION_NONCE para cada llamada
        // en lugar de generar un nuevo nonce aleatorio.  No reutilizar con
        // la misma clave rompe las garantías de confidencialidad de la AEAD.
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

    // / Descifrar los datos del ticket utilizando la clave de cifrado actual.
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

// ---------------------------------------------------------------------
// Ayudantes de visualización/resumen
// ---------------------------------------------------------------------

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
    // / Devuelve una línea de resumen para registro/diagnóstico.
    pub fn summary(&self) -> String {
        format!(
            "SessionCache {{ sessions: {}, key_id: {}, max: {} }}",
            self.cache.len(),
            self.encryption_key.key_id,
            self.max_size,
        )
    }
}

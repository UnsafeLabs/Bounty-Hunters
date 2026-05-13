#[path = "../tls_session.rs"]
mod tls_session;

use std::panic;

use tls_session::{CipherSuite, SessionCache, SessionError, SessionTicket};

fn new_cache() -> SessionCache {
    SessionCache::new(vec![0x11, 0x22, 0x33, 0x44])
}

fn sample_ticket(id: &str) -> SessionTicket {
    SessionTicket {
        ticket_id: id.to_string(),
        cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
        master_secret: vec![1, 2, 3, 4],
        issued_at: 100,
        lifetime_secs: 7200,
        encrypted_state: vec![5, 6, 7, 8],
        creation_time: 100,
    }
}

#[test]
fn new_cache_starts_empty() {
    let cache = new_cache();

    assert_eq!(cache.session_count(), 0);
    assert!(cache.summary().contains("sessions: 0"));
}

#[test]
fn store_session_adds_ticket_to_cache() {
    let mut cache = new_cache();

    cache.store_session(sample_ticket("ticket-1")).unwrap();

    assert_eq!(cache.session_count(), 1);
}

#[test]
fn get_session_returns_existing_unexpired_ticket() {
    let mut cache = new_cache();
    cache.store_session(sample_ticket("ticket-1")).unwrap();

    let ticket = cache.get_session("ticket-1");

    assert_eq!(ticket.unwrap().ticket_id, "ticket-1");
}

#[test]
fn get_session_panics_for_missing_ticket_current_behavior() {
    let cache = new_cache();

    let result = panic::catch_unwind(|| {
        let _ = cache.get_session("missing-ticket");
    });

    assert!(result.is_err());
}

#[test]
fn remove_session_returns_ticket_and_decrements_count() {
    let mut cache = new_cache();
    cache.store_session(sample_ticket("ticket-1")).unwrap();

    let removed = cache.remove_session("ticket-1");

    assert_eq!(removed.unwrap().ticket_id, "ticket-1");
    assert_eq!(cache.session_count(), 0);
}

#[test]
fn issue_ticket_stores_ticket_with_expected_cipher_suite() {
    let mut cache = new_cache();

    let ticket = cache
        .issue_ticket(CipherSuite::TlsAes256GcmSha384, vec![9, 8, 7, 6])
        .unwrap();

    assert_eq!(ticket.cipher_suite, CipherSuite::TlsAes256GcmSha384 as u16);
    assert_eq!(cache.session_count(), 1);
}

#[test]
fn encrypt_then_decrypt_round_trips_plaintext() {
    let cache = new_cache();
    let plaintext = b"session-secret";

    let ciphertext = cache.encrypt_ticket(plaintext).unwrap();
    let decrypted = cache.decrypt_ticket(&ciphertext).unwrap();

    assert_eq!(decrypted, plaintext);
    assert_eq!(ciphertext.len(), plaintext.len() + 12);
}

#[test]
fn encrypt_ticket_rejects_empty_key_material() {
    let cache = SessionCache::new(Vec::new());

    let error = cache.encrypt_ticket(b"plaintext").unwrap_err();

    assert!(matches!(error, SessionError::EncryptionFailed(_)));
}

#[test]
fn decrypt_ticket_rejects_short_ciphertext() {
    let cache = new_cache();

    let error = cache.decrypt_ticket(b"too-short").unwrap_err();

    assert!(matches!(error, SessionError::DecryptionFailed(_)));
}

#[test]
fn session_ticket_display_includes_id_suite_and_lifetime() {
    let ticket = sample_ticket("ticket-1");
    let rendered = ticket.to_string();

    assert!(rendered.contains("ticket-1"));
    assert!(rendered.contains("0x1301"));
    assert!(rendered.contains("7200s"));
}

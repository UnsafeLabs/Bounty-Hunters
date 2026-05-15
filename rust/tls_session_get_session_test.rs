#[path = "tls_session.rs"]
mod tls_session;

use tls_session::{CipherSuite, SessionCache, SessionTicket};

fn test_ticket(ticket_id: &str, issued_at: u64, lifetime_secs: u64) -> SessionTicket {
    SessionTicket {
        ticket_id: ticket_id.to_string(),
        cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
        master_secret: vec![1, 2, 3, 4],
        issued_at,
        lifetime_secs,
        encrypted_state: vec![],
        creation_time: 0,
    }
}

#[test]
fn missing_ticket_returns_none_instead_of_panicking() {
    let cache = SessionCache::new(vec![0xaa; 32]);

    assert!(cache.get_session("missing_ticket").is_none());
}

#[test]
fn existing_unexpired_ticket_is_returned() {
    let mut cache = SessionCache::new(vec![0xaa; 32]);
    cache.store_session(test_ticket("tkt_1_12345", 10, 7200)).unwrap();

    assert!(cache.get_session("tkt_1_12345").is_some());
}

#[test]
fn existing_expired_ticket_returns_none_without_panicking() {
    let mut cache = SessionCache::new(vec![0xaa; 32]);
    cache.store_session(test_ticket("expired", 7201, 7200)).unwrap();

    assert!(cache.get_session("expired").is_none());
}
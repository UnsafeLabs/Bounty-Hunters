#[path = "tls_session.rs"]
mod tls_session;

use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tls_session::{CipherSuite, SessionCache, SessionTicket};

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn test_ticket(ticket_id: &str, issued_at: u64, lifetime_secs: u64) -> SessionTicket {
    SessionTicket {
        ticket_id: ticket_id.to_string(),
        cipher_suite: CipherSuite::TlsAes128GcmSha256 as u16,
        master_secret: vec![1, 2, 3, 4],
        issued_at,
        lifetime_secs,
        encrypted_state: vec![],
        creation_time: issued_at,
    }
}

#[test]
fn ticket_older_than_lifetime_is_expired() {
    let mut cache = SessionCache::new(vec![0xaa; 32]);
    cache.store_session(test_ticket("old", now_secs() - 7201, 7200)).unwrap();

    assert!(cache.get_session("old").is_none());
}

#[test]
fn recent_ticket_is_not_expired() {
    let mut cache = SessionCache::new(vec![0xaa; 32]);
    cache.store_session(test_ticket("recent", now_secs() - 100, 7200)).unwrap();

    assert!(cache.get_session("recent").is_some());
}
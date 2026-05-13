use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};

/// Length of the AES-GCM nonce in bytes.
const NONCE_LEN: usize = 12;

/// An encryption key used for ticket encryption/decryption.
pub struct EncryptionKey {
    cipher: Aes256Gcm,
}

impl EncryptionKey {
    /// Creates a new `EncryptionKey` from a 32-byte raw key.
    pub fn new(raw_key: &[u8; 32]) -> Self {
        let key = Key::<Aes256Gcm>::from_slice(raw_key);
        let cipher = Aes256Gcm::new(key);
        EncryptionKey { cipher }
    }
}

/// Encrypts a ticket using AES-256-GCM with a **fresh random nonce** on every call.
///
/// The output format is: `[12-byte nonce] || [ciphertext + 16-byte GCM tag]`
///
/// Prepending the nonce to the ciphertext allows `decrypt_ticket()` to recover
/// it without any additional storage.  The nonce is not secret — only the key
/// must remain confidential.
///
/// # Security note
/// A unique nonce is generated via `OsRng` on **every** call.  Never reuse a
/// nonce with the same key; doing so completely breaks AES-GCM confidentiality.
pub fn encrypt_ticket(key: &EncryptionKey, plaintext: &[u8]) -> Result<Vec<u8>, aes_gcm::Error> {
    // Generate a fresh random 12-byte nonce for every encryption operation.
    // OsRng is a cryptographically secure random number generator.
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    // Encrypt the plaintext. The cipher appends a 16-byte authentication tag.
    let ciphertext = key.cipher.encrypt(&nonce, plaintext)?;

    // Prepend the nonce so that decrypt_ticket() can recover it.
    // Output layout: [ nonce (12 bytes) | ciphertext+tag (N+16 bytes) ]
    let mut output = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

/// Decrypts a ticket produced by `encrypt_ticket()`.
///
/// Expects the input to be in the format: `[12-byte nonce] || [ciphertext + tag]`
pub fn decrypt_ticket(key: &EncryptionKey, data: &[u8]) -> Result<Vec<u8>, aes_gcm::Error> {
    if data.len() < NONCE_LEN {
        // Return an AES-GCM error rather than panicking on a slice bounds error.
        return Err(aes_gcm::Error);
    }

    // Split the prepended nonce from the actual ciphertext.
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    key.cipher.decrypt(nonce, ciphertext)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed 32-byte test key.  Never use a hardcoded key in production.
    const TEST_KEY: [u8; 32] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    ];

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::new(&TEST_KEY);
        let plaintext = b"session_token=abc123&user=alice";

        let ciphertext = encrypt_ticket(&key, plaintext).expect("encryption failed");
        let recovered = decrypt_ticket(&key, &ciphertext).expect("decryption failed");

        assert_eq!(recovered, plaintext);
    }

    /// Two calls with identical plaintext MUST produce different ciphertexts.
    /// If this test fails, nonce reuse is occurring.
    #[test]
    fn test_fresh_nonce_on_every_call() {
        let key = EncryptionKey::new(&TEST_KEY);
        let plaintext = b"same_data";

        let ct1 = encrypt_ticket(&key, plaintext).expect("first encryption failed");
        let ct2 = encrypt_ticket(&key, plaintext).expect("second encryption failed");

        // Different nonces → different ciphertexts, even for identical plaintext.
        assert_ne!(
            ct1, ct2,
            "nonce reuse detected: two ciphertexts are identical"
        );

        // Both must still decrypt correctly.
        let pt1 = decrypt_ticket(&key, &ct1).expect("first decryption failed");
        let pt2 = decrypt_ticket(&key, &ct2).expect("second decryption failed");
        assert_eq!(pt1, plaintext);
        assert_eq!(pt2, plaintext);
    }

    /// The nonces embedded in the two outputs must differ.
    #[test]
    fn test_nonces_are_distinct() {
        let key = EncryptionKey::new(&TEST_KEY);
        let plaintext = b"same_data";

        let ct1 = encrypt_ticket(&key, plaintext).expect("first encryption failed");
        let ct2 = encrypt_ticket(&key, plaintext).expect("second encryption failed");

        let nonce1 = &ct1[..NONCE_LEN];
        let nonce2 = &ct2[..NONCE_LEN];

        assert_ne!(nonce1, nonce2, "nonces must not be reused");
    }

    #[test]
    fn test_decrypt_with_wrong_key_fails() {
        let key = EncryptionKey::new(&TEST_KEY);
        let wrong_key_bytes = [0xffu8; 32];
        let wrong_key = EncryptionKey::new(&wrong_key_bytes);

        let ciphertext = encrypt_ticket(&key, b"secret").expect("encryption failed");
        let result = decrypt_ticket(&wrong_key, &ciphertext);

        assert!(result.is_err(), "decryption with wrong key must fail");
    }

    #[test]
    fn test_decrypt_truncated_input_fails() {
        let key = EncryptionKey::new(&TEST_KEY);
        // Fewer than NONCE_LEN bytes — must not panic.
        let result = decrypt_ticket(&key, &[0u8; 4]);
        assert!(result.is_err(), "decryption of truncated input must fail");
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = EncryptionKey::new(&TEST_KEY);
        let mut ciphertext = encrypt_ticket(&key, b"important data").expect("encryption failed");

        // Flip a byte in the ciphertext portion (after the nonce).
        ciphertext[NONCE_LEN] ^= 0xff;

        let result = decrypt_ticket(&key, &ciphertext);
        assert!(result.is_err(), "tampered ciphertext must fail authentication");
    }
}

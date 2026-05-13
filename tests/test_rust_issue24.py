import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class RustKeyRotationStaticTests(unittest.TestCase):
    def test_rotate_key_reencrypts_cached_tickets(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()

        self.assertIn("pub fn rotate_key(&mut self, new_material: Vec<u8>)", source)
        self.assertIn("let old_key = self.encryption_key.clone();", source)
        self.assertIn("let new_key = EncryptionKey::new(old_key.key_id + 1, new_material);", source)
        self.assertIn("for ticket in inner.values_mut()", source)
        self.assertIn("ticket.encrypted_state = encrypt_with_key(&plaintext, &new_key.key_material);", source)
        self.assertIn("self.encryption_key = new_key;", source)


if __name__ == "__main__":
    unittest.main()

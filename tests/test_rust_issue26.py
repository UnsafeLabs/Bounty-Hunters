import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class RustNonceStaticTests(unittest.TestCase):
    def test_encrypt_ticket_uses_fresh_nonce_helper(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()
        encrypt_ticket = source.split("pub fn encrypt_ticket", 1)[1].split("pub fn decrypt_ticket", 1)[0]

        self.assertNotIn("const ENCRYPTION_NONCE", source)
        self.assertIn("static NONCE_COUNTER", source)
        self.assertIn("fn fresh_nonce() -> [u8; 12]", source)
        self.assertIn("let nonce = fresh_nonce();", encrypt_ticket)


if __name__ == "__main__":
    unittest.main()

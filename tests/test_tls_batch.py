import hmac
import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_tls_handshake():
    path = ROOT / "python" / "tls_handshake.py"
    spec = importlib.util.spec_from_file_location("tls_handshake", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PythonTLSHandshakeTests(unittest.TestCase):
    def setUp(self):
        self.tls = load_tls_handshake()

    def test_sni_extension_sets_server_name(self):
        hostname = b"example.com"
        server_name = b"\x00" + len(hostname).to_bytes(2, "big") + hostname
        ext_data = len(server_name).to_bytes(2, "big") + server_name
        raw_ext = (
            self.tls.EXT_SNI.to_bytes(2, "big")
            + len(ext_data).to_bytes(2, "big")
            + ext_data
        )

        handshake = self.tls.TLSHandshake()
        extensions = handshake.parse_extensions(raw_ext)

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_missing_sni_leaves_server_name_unset(self):
        handshake = self.tls.TLSHandshake()
        handshake.parse_extensions(b"")
        self.assertIsNone(handshake.server_name)

    def test_verify_finished_uses_compare_digest(self):
        handshake = self.tls.TLSHandshake()
        handshake.master_secret = b"m" * 48
        received = handshake._prf(
            handshake.master_secret,
            b"client finished",
            handshake.handshake_hash.copy().digest(),
            12,
        )

        with mock.patch.object(hmac, "compare_digest", wraps=hmac.compare_digest) as compare:
            self.assertTrue(handshake.verify_finished(received, "client finished"))
            compare.assert_called_once()

    def test_ems_uses_distinct_prf_label(self):
        base = self.tls.TLSHandshake()
        base._pre_master_secret = b"p" * 48
        base.client_random = b"c" * 32
        base.server_random = b"s" * 32
        base.negotiated_ems = False
        base._derive_master_secret()

        ems = self.tls.TLSHandshake()
        ems._pre_master_secret = b"p" * 48
        ems.client_random = b"c" * 32
        ems.server_random = b"s" * 32
        ems.negotiated_ems = True
        ems._derive_master_secret()

        self.assertNotEqual(base.master_secret, ems.master_secret)


class StaticSourceChecks(unittest.TestCase):
    def test_assembly_batch_fixes_are_present(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        self.assertIn('err_alert_warning   db "WARNING: alert received from peer", 10, 0', source)
        self.assertIn("jg .invalid_type", source)
        self.assertIn("movzx eax, byte [rsi+1]", source)
        self.assertIn("cmp rax, r12", source)
        self.assertIn('msg_tls13_record    db "TLS 1.3 record detected", 10, 0', source)
        self.assertIn("movzx edi, byte [rdi+rcx-1]", source)

    def test_rust_batch_fixes_are_present(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()
        self.assertIn("Arc<RwLock<HashMap<String, SessionTicket>>>", source)
        self.assertIn("pub fn get_session(&self, ticket_id: &str) -> Option<SessionTicket>", source)
        self.assertIn("pub fn rotate_key(&mut self, new_material: Vec<u8>)", source)
        self.assertIn("fn fresh_nonce() -> [u8; 12]", source)
        self.assertNotIn("const ENCRYPTION_NONCE", source)
        self.assertIn("now.saturating_sub(ticket.issued_at)", source)


if __name__ == "__main__":
    unittest.main()

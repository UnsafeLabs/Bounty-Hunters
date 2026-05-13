import unittest

from tls_handshake import (
    EXT_SNI,
    HandshakeMessage,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
)


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_finished_cannot_follow_client_hello_directly(self):
        handshake = TLSHandshake()

        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_parse_extensions_decodes_sni_hostname(self):
        hostname = b"api.example.test"
        sni_entry = b"\x00" + len(hostname).to_bytes(2, "big") + hostname
        sni_list = len(sni_entry).to_bytes(2, "big") + sni_entry
        extension = (
            EXT_SNI.to_bytes(2, "big")
            + len(sni_list).to_bytes(2, "big")
            + sni_list
        )
        handshake = TLSHandshake()

        parsed = handshake.parse_extensions(extension)

        self.assertEqual(parsed[0].server_name, "api.example.test")
        self.assertEqual(handshake.server_name, "api.example.test")

    def test_process_key_exchange_returns_false_for_expected_parse_errors(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x30" + b"x" * 47,
        )

        self.assertFalse(handshake.process_key_exchange(message))

    def test_process_key_exchange_does_not_swallow_unexpected_errors(self):
        class ExplodingHandshake(TLSHandshake):
            def _decrypt_pre_master_secret(self, encrypted):
                raise RuntimeError("unexpected decrypt failure")

        handshake = ExplodingHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x30" + b"x" * 48,
        )

        with self.assertRaises(RuntimeError):
            handshake.process_key_exchange(message)

    def test_derive_master_secret_uses_ems_label_when_negotiated(self):
        class RecordingHandshake(TLSHandshake):
            def __init__(self, negotiated_ems):
                super().__init__()
                self.negotiated_ems = negotiated_ems
                self._pre_master_secret = b"p" * 48
                self.client_random = b"c" * 32
                self.server_random = b"s" * 32
                self.labels = []

            def _prf(self, secret, label, seed, output_len):
                self.labels.append(label)
                return bytes([len(label) % 256]) * output_len

        standard = RecordingHandshake(False)
        standard._derive_master_secret()
        ems = RecordingHandshake(True)
        ems._derive_master_secret()

        self.assertEqual(standard.labels[-1], b"master secret")
        self.assertEqual(ems.labels[-1], b"extended master secret")
        self.assertNotEqual(standard.master_secret, ems.master_secret)


if __name__ == "__main__":
    unittest.main()

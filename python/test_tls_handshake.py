import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class TLSHandshakeRegressionTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

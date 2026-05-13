import unittest
from unittest.mock import patch

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class KeyExchangeErrorHandlingTests(unittest.TestCase):
    def test_expected_value_error_returns_false(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        self.assertFalse(handshake.process_key_exchange(message))

    def test_unexpected_exception_propagates(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x30" + b"e" * 48,
        )

        with patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=TypeError("unexpected"),
        ):
            with self.assertRaises(TypeError):
                handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

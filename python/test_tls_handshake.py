import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class TLSHandshakeKeyExchangeErrorTests(unittest.TestCase):
    def test_process_key_exchange_returns_false_for_expected_errors(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        self.assertFalse(handshake.process_key_exchange(message))
        self.assertEqual(handshake.last_error, "Key exchange payload too short")

    def test_process_key_exchange_propagates_unexpected_errors(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + b"x" * 48)

        with patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=TypeError("unexpected decrypt failure"),
        ):
            with self.assertRaises(TypeError):
                handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

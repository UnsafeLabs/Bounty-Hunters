import struct
import unittest
from unittest.mock import patch

from python.tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class TLSProcessKeyExchangeTests(unittest.TestCase):
    def test_malformed_key_exchange_returns_false_for_value_error(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30short")

        self.assertFalse(handshake.process_key_exchange(message))

    def test_struct_error_returns_false(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + b"x" * 48)

        with patch("python.tls_handshake.struct.unpack", side_effect=struct.error):
            self.assertFalse(handshake.process_key_exchange(message))

    def test_unexpected_type_error_propagates(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + b"x" * 48)

        with patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=TypeError("programming error"),
        ):
            with self.assertRaises(TypeError):
                handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

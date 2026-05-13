import struct
import unittest
from unittest.mock import patch

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class ProcessKeyExchangeTests(unittest.TestCase):
    def make_message(self, payload):
        return HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)

    def test_expected_value_error_returns_false_and_logs(self):
        handshake = TLSHandshake()
        message = self.make_message(b"\x00")

        with self.assertLogs("tls_handshake", level="WARNING") as logs:
            self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Key exchange failed", logs.output[0])
        self.assertIn("payload too short", logs.output[0])

    def test_expected_struct_error_returns_false_and_logs(self):
        handshake = TLSHandshake()
        message = self.make_message(b"\x00\x30" + b"x" * 48)
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32

        with patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=struct.error("bad structure"),
        ):
            with self.assertLogs("tls_handshake", level="WARNING") as logs:
                self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Key exchange failed", logs.output[0])

    def test_unexpected_type_error_propagates(self):
        handshake = TLSHandshake()
        message = self.make_message(b"\x00\x30" + b"x" * 48)

        with patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=TypeError("unexpected"),
        ):
            with self.assertRaises(TypeError):
                handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

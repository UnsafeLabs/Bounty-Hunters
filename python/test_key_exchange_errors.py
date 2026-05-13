import unittest
from unittest import mock

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class KeyExchangeErrorTests(unittest.TestCase):
    def test_process_key_exchange_logs_expected_errors(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x01x",
        )

        with self.assertLogs("tls_handshake", level="DEBUG") as logs:
            result = handshake.process_key_exchange(message)

        self.assertFalse(result)
        self.assertIn("Failed to decrypt pre-master secret", logs.output[0])

    def test_process_key_exchange_propagates_unexpected_errors(self):
        handshake = TLSHandshake()
        handshake._decrypt_pre_master_secret = mock.Mock(
            side_effect=TypeError("unexpected")
        )
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x30" + (b"x" * 48),
        )

        with self.assertRaises(TypeError):
            handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

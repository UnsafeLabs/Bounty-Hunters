import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class TLSHandshakeKeyExchangeTests(unittest.TestCase):
    def test_malformed_key_exchange_records_failure_reason(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        self.assertFalse(handshake.process_key_exchange(message))
        self.assertEqual(handshake.key_exchange_error, "Key exchange payload too short")


if __name__ == "__main__":
    unittest.main()

import struct
import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class ProcessKeyExchangeErrorTests(unittest.TestCase):
    def test_expected_key_exchange_errors_return_false(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        with self.assertLogs("tls_handshake", level="DEBUG"):
            self.assertFalse(handshake.process_key_exchange(message))

    def test_unexpected_key_exchange_errors_propagate(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + (b"a" * 48))
        handshake._decrypt_pre_master_secret = lambda encrypted: (_ for _ in ()).throw(TypeError("boom"))

        with self.assertRaises(TypeError):
            handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()
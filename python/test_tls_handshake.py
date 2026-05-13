import logging
import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class ProcessKeyExchangeErrorTests(unittest.TestCase):
    def test_expected_value_error_returns_false_and_logs(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x05short")

        with self.assertLogs("tls_handshake", level=logging.WARNING) as logs:
            self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Failed to decrypt pre-master secret", logs.output[0])

    def test_expected_struct_error_returns_false_and_logs(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        with self.assertLogs("tls_handshake", level=logging.WARNING) as logs:
            self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Key exchange failed", logs.output[0])

    def test_unexpected_type_error_propagates(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + (b"a" * 48))
        handshake._decrypt_pre_master_secret = lambda encrypted: (_ for _ in ()).throw(TypeError("boom"))

        with self.assertRaisesRegex(TypeError, "boom"):
            handshake.process_key_exchange(message)

    def test_unexpected_keyboard_interrupt_propagates(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + (b"a" * 48))
        handshake._derive_master_secret = lambda: (_ for _ in ()).throw(KeyboardInterrupt())

        with self.assertRaises(KeyboardInterrupt):
            handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

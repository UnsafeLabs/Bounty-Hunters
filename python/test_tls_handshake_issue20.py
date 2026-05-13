import struct
import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


class KeyExchangeErrorTests(unittest.TestCase):
    def test_process_key_exchange_records_expected_validation_errors(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30short")

        self.assertFalse(handshake.process_key_exchange(message))
        self.assertEqual(handshake.last_error, "Pre-master secret length mismatch")

    def test_process_key_exchange_success_clears_last_error(self):
        handshake = TLSHandshake()
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.last_error = "previous error"
        pms = b"x" * 48
        payload = struct.pack("!H", len(pms)) + pms
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)

        self.assertTrue(handshake.process_key_exchange(message))
        self.assertIsNone(handshake.last_error)
        self.assertIsNotNone(handshake.master_secret)

    def test_unexpected_key_exchange_errors_are_not_swallowed(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + b"x" * 48)

        def explode(_encrypted):
            raise RuntimeError("boom")

        handshake._decrypt_pre_master_secret = explode

        with self.assertRaisesRegex(RuntimeError, "boom"):
            handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

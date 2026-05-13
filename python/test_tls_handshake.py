import struct
import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


def client_key_exchange_payload(secret: bytes) -> bytes:
    return struct.pack("!H", len(secret)) + secret


class KeyExchangeErrorHandlingTests(unittest.TestCase):
    def test_process_key_exchange_logs_expected_errors(self) -> None:
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        with self.assertLogs("tls_handshake", level="WARNING") as logs:
            self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Key exchange payload too short", logs.output[0])

    def test_process_key_exchange_propagates_unexpected_errors(self) -> None:
        handshake = TLSHandshake()
        secret = b"a" * 48
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            client_key_exchange_payload(secret),
        )

        def raise_type_error(_: bytes) -> bytes:
            raise TypeError("unexpected failure")

        handshake._decrypt_pre_master_secret = raise_type_error

        with self.assertRaises(TypeError):
            handshake.process_key_exchange(message)

    def test_process_key_exchange_still_accepts_valid_payload(self) -> None:
        handshake = TLSHandshake()
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        secret = b"p" * 48
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            client_key_exchange_payload(secret),
        )

        self.assertTrue(handshake.process_key_exchange(message))
        self.assertIsNotNone(handshake.master_secret)


if __name__ == "__main__":
    unittest.main()

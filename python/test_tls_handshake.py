"""Regression tests for process_key_exchange() exception handling (issue #20)."""

import struct
import unittest

from tls_handshake import HandshakeMessage, HandshakeType, TLSHandshake


def _make_message(payload: bytes) -> HandshakeMessage:
    return HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)


class ProcessKeyExchangeExceptionTests(unittest.TestCase):
    def test_value_error_returns_false_without_raising(self):
        handshake = TLSHandshake()
        # Payload claims pms_len that exceeds the actual payload bytes,
        # so the implementation raises ValueError; the caller should see False.
        bad_payload = struct.pack("!H", 999) + b"\x00\x00"
        message = _make_message(bad_payload)

        self.assertFalse(handshake.process_key_exchange(message))

    def test_struct_error_returns_false(self):
        handshake = TLSHandshake()
        # Empty payload triggers ValueError ("Key exchange payload too short")
        # before struct.unpack runs; both paths must collapse to False without
        # raising to the caller.
        message = _make_message(b"")

        self.assertFalse(handshake.process_key_exchange(message))

    def test_unexpected_exception_propagates(self):
        handshake = TLSHandshake()
        # Patch the decryption helper to raise a TypeError; the caller must
        # see the TypeError, not a silenced False.
        def boom(_encrypted):
            raise TypeError("unexpected")

        handshake._decrypt_pre_master_secret = boom
        message = _make_message(struct.pack("!H", 48) + b"\x00" * 48)

        with self.assertRaises(TypeError):
            handshake.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

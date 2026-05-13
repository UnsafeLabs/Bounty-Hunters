import hmac
import struct
import unittest
from unittest.mock import patch

from tls_handshake import (
    EXT_SNI,
    HandshakeMessage,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
    VALID_TRANSITIONS,
)


def handshake_record(message_type: HandshakeType, payload: bytes) -> bytes:
    handshake = bytes([message_type.value]) + len(payload).to_bytes(3, "big") + payload
    return bytes([22, 3, 3]) + len(handshake).to_bytes(2, "big") + handshake


def sni_extension(hostname: str) -> bytes:
    name = hostname.encode("idna")
    server_name = bytes([0]) + len(name).to_bytes(2, "big") + name
    server_name_list = len(server_name).to_bytes(2, "big") + server_name
    return struct.pack("!HH", EXT_SNI, len(server_name_list)) + server_name_list


class TLSHandshakeSecurityTest(unittest.TestCase):
    def test_client_hello_cannot_transition_directly_to_finished(self):
        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )

        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_finished_after_client_hello_is_rejected_and_sets_error(self):
        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO
        handshake.master_secret = b"x" * 48

        ok, message = handshake.process_message(
            handshake_record(HandshakeType.FINISHED, b"bad-verify")
        )

        self.assertFalse(ok)
        self.assertIn("Finished", message)
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_parse_extensions_decodes_sni_hostname(self):
        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(sni_extension("example.com"))

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_no_sni_leaves_server_name_unset(self):
        handshake = TLSHandshake()

        self.assertEqual(handshake.parse_extensions(b""), [])
        self.assertIsNone(handshake.server_name)

    def test_verify_finished_uses_constant_time_compare(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"x" * 48

        with patch("tls_handshake.hmac.compare_digest", wraps=hmac.compare_digest) as compare:
            handshake.verify_finished(b"bad-verify", "client finished")

        compare.assert_called_once()

    def test_process_key_exchange_marks_state_error_on_bad_payload(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30short")

        self.assertFalse(handshake.process_key_exchange(message))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_extended_master_secret_uses_rfc7627_label(self):
        handshake = TLSHandshake()
        handshake.negotiated_ems = True
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32

        handshake._derive_master_secret()

        expected = handshake._prf(
            b"p" * 48,
            b"extended master secret",
            b"c" * 32 + b"s" * 32,
            48,
        )
        standard = handshake._prf(
            b"p" * 48,
            b"master secret",
            b"c" * 32 + b"s" * 32,
            48,
        )

        self.assertEqual(handshake.master_secret, expected)
        self.assertNotEqual(handshake.master_secret, standard)


if __name__ == "__main__":
    unittest.main()

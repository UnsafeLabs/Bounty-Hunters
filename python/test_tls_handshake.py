"""Tests for TLS handshake state machine fixes."""

import unittest
import struct
import hmac
import hashlib
from tls_handshake import (
    TLSHandshake, HandshakeState, HandshakeType, ContentType,
    EXT_SNI, EXT_EXTENDED_MASTER_SECRET, VALID_TRANSITIONS
)


class TestTransitionsFix(unittest.TestCase):
    """Issue #16: VALID_TRANSITIONS should not allow CLIENT_HELLO -> FINISHED"""

    def test_client_hello_to_finished_is_blocked(self):
        tls = TLSHandshake()
        tls.state = HandshakeState.CLIENT_HELLO
        result = tls.transition_to(HandshakeState.FINISHED)
        self.assertFalse(result)
        self.assertEqual(tls.state, HandshakeState.ERROR)

    def test_client_hello_to_server_hello_is_allowed(self):
        tls = TLSHandshake()
        tls.state = HandshakeState.CLIENT_HELLO
        result = tls.transition_to(HandshakeState.SERVER_HELLO)
        self.assertTrue(result)
        self.assertEqual(tls.state, HandshakeState.SERVER_HELLO)


class TestSniParsingFix(unittest.TestCase):
    """Issue #17: SNI extension should extract server_name"""

    def _build_sni_extension(self, hostname):
        name_bytes = hostname.encode("ascii")
        ext_data = struct.pack("!H", 3 + len(name_bytes))
        ext_data += bytes([0x00])  # name_type
        ext_data += struct.pack("!H", len(name_bytes))
        ext_data += name_bytes
        return ext_data

    def test_sni_hostname_extracted(self):
        tls = TLSHandshake()
        sni_data = self._build_sni_extension("example.com")
        extensions = tls.parse_extensions(
            struct.pack("!HH", EXT_SNI, len(sni_data)) + sni_data
        )
        self.assertEqual(tls.server_name, "example.com")
        self.assertEqual(extensions[0].server_name, "example.com")

    def test_no_sni_leaves_none(self):
        tls = TLSHandshake()
        self.assertIsNone(tls.server_name)


class TestTimingAttackFix(unittest.TestCase):
    """Issue #18: verify_finished should use hmac.compare_digest"""

    def test_verify_returns_bool(self):
        tls = TLSHandshake(is_server=True)
        tls.master_secret = b"\x00" * 48
        tls.handshake_hash.update(b"test data")
        result = tls.verify_finished(b"wrong_data", "server finished")
        self.assertIsInstance(result, bool)

    def test_verify_false_on_wrong_data(self):
        tls = TLSHandshake(is_server=True)
        tls.master_secret = b"\x00" * 48
        tls.handshake_hash.update(b"test data")
        result = tls.verify_finished(b"\xff" * 12, "server finished")
        self.assertFalse(result)


class TestExceptSwallowFix(unittest.TestCase):
    """Issue #20: process_key_exchange should not swallow all exceptions"""

    def test_returns_false_on_short_payload(self):
        tls = TLSHandshake()
        tls.client_random = b"\x00" * 32
        tls.server_random = b"\x00" * 32
        from tls_handshake import HandshakeMessage
        msg = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")
        result = tls.process_key_exchange(msg)
        self.assertFalse(result)


class TestEmsLabelFix(unittest.TestCase):
    """Issue #21: EMS should use 'extended master secret' label"""

    def test_ems_produces_different_master_secret(self):
        tls_no_ems = TLSHandshake()
        tls_no_ems.client_random = b"\x01" * 32
        tls_no_ems.server_random = b"\x02" * 32
        tls_no_ems._pre_master_secret = b"\x03" * 48
        tls_no_ems.negotiated_ems = False
        tls_no_ems._derive_master_secret()

        tls_ems = TLSHandshake()
        tls_ems.client_random = b"\x01" * 32
        tls_ems.server_random = b"\x02" * 32
        tls_ems._pre_master_secret = b"\x03" * 48
        tls_ems.negotiated_ems = True
        tls_ems._derive_master_secret()

        self.assertNotEqual(tls_no_ems.master_secret, tls_ems.master_secret)
        self.assertEqual(len(tls_ems.master_secret), 48)


if __name__ == "__main__":
    unittest.main()

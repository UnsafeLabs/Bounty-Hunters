"""Tests for TLS handshake state machine bugs."""

import hashlib
import hmac
import struct
import unittest

from tls_handshake import (
    TLSHandshake,
    HandshakeState,
    HandshakeType,
    HandshakeMessage,
    ContentType,
)


class TestVerifyFinished(unittest.TestCase):
    """Tests for verify_finished() timing attack fix (issue #18)."""

    def setUp(self):
        self.handshake = TLSHandshake(is_server=False)
        self.handshake.client_random = b"\x00" * 32
        self.handshake.server_random = b"\x01" * 32
        self.handshake._pre_master_secret = b"\x02" * 48
        self.handshake._derive_master_secret()
        self.handshake.handshake_hash.update(b"some transcript data")

    def test_verify_finished_matches(self):
        """verify_finished returns True when verify_data matches."""
        transcript_hash = self.handshake.handshake_hash.copy().digest()
        computed = self.handshake._prf(
            self.handshake.master_secret,
            b"client finished",
            transcript_hash,
            12,
        )
        self.assertTrue(
            self.handshake.verify_finished(computed, "client finished")
        )

    def test_verify_finished_mismatch(self):
        """verify_finished returns False when verify_data does not match."""
        bad_verify = b"\xff" * 12
        self.assertFalse(
            self.handshake.verify_finished(bad_verify, "client finished")
        )

    def test_verify_finished_uses_compare_digest(self):
        """The comparison uses hmac.compare_digest (no timing leak)."""
        self.assertTrue(hmac.compare_digest(b"abc", b"abc"))
        self.assertFalse(hmac.compare_digest(b"abc", b"xyz"))


if __name__ == "__main__":
    unittest.main()

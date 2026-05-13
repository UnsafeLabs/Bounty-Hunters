import hashlib
import unittest
from unittest.mock import patch

import tls_handshake
from tls_handshake import TLSHandshake


class VerifyFinishedTests(unittest.TestCase):
    def make_handshake(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"\x11" * 48
        handshake.handshake_hash.update(b"client hello server hello")
        return handshake

    def expected_verify_data(self, handshake, label="client finished"):
        transcript_hash = handshake.handshake_hash.copy().digest()
        return handshake._prf(
            handshake.master_secret,
            label.encode("ascii"),
            transcript_hash,
            12,
        )

    def test_verify_finished_uses_compare_digest(self):
        handshake = self.make_handshake()
        expected = self.expected_verify_data(handshake)

        with patch.object(tls_handshake.hmac, "compare_digest", return_value=True) as compare:
            self.assertTrue(handshake.verify_finished(expected, "client finished"))

        compare.assert_called_once_with(expected, expected)

    def test_verify_finished_preserves_bool_match_behavior(self):
        handshake = self.make_handshake()
        expected = self.expected_verify_data(handshake)
        mismatch = hashlib.sha256(expected).digest()[:12]

        self.assertTrue(handshake.verify_finished(expected, "client finished"))
        self.assertFalse(handshake.verify_finished(mismatch, "client finished"))


if __name__ == "__main__":
    unittest.main()

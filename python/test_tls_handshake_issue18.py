import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class FinishedVerificationTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_compare(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master secret"
        expected = handshake._prf(
            handshake.master_secret,
            b"client finished",
            handshake.handshake_hash.copy().digest(),
            12,
        )

        with patch("tls_handshake.hmac.compare_digest", return_value=True) as compare_digest:
            self.assertTrue(handshake.verify_finished(expected, "client finished"))

        compare_digest.assert_called_once()
        self.assertEqual(compare_digest.call_args.args[0], expected)
        self.assertEqual(compare_digest.call_args.args[1], expected)

    def test_verify_finished_rejects_mismatch(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master secret"

        self.assertFalse(handshake.verify_finished(b"wrong verify", "client finished"))


if __name__ == "__main__":
    unittest.main()

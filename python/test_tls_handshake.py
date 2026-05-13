import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import TLSHandshake


class TLSHandshakeFinishedVerificationTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_comparison(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master secret for tests"
        received_verify = b"\x00" * 12

        with patch("tls_handshake.hmac.compare_digest", return_value=False) as compare_digest:
            self.assertFalse(handshake.verify_finished(received_verify, "client finished"))

        compare_digest.assert_called_once()
        self.assertEqual(compare_digest.call_args.args[1], received_verify)

    def test_verify_finished_returns_true_when_verify_data_matches(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master secret for tests"
        transcript_hash = handshake.handshake_hash.copy().digest()
        expected_verify = handshake._prf(
            handshake.master_secret,
            b"client finished",
            transcript_hash,
            12,
        )

        self.assertTrue(handshake.verify_finished(expected_verify, "client finished"))
        self.assertFalse(
            handshake.verify_finished(b"\xff" + expected_verify[1:], "client finished")
        )


if __name__ == "__main__":
    unittest.main()

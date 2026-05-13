import hmac
import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class VerifyFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_comparison(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48
        received_verify = b"expected"

        with patch.object(handshake, "_prf", return_value=received_verify), \
                patch.object(hmac, "compare_digest", return_value=True) as compare_digest:
            self.assertTrue(handshake.verify_finished(received_verify, "client finished"))

        compare_digest.assert_called_once_with(received_verify, received_verify)

    def test_verify_finished_returns_false_for_mismatch(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48

        with patch.object(handshake, "_prf", return_value=b"expected"):
            self.assertFalse(handshake.verify_finished(b"different", "client finished"))


if __name__ == "__main__":
    unittest.main()

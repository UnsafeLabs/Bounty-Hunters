import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_compare_digest(self):
        class FixedVerifyHandshake(TLSHandshake):
            def _prf(self, secret, label, seed, output_len):
                return b"v" * output_len

        handshake = FixedVerifyHandshake()
        handshake.master_secret = b"m" * 48

        with patch("tls_handshake.hmac.compare_digest", return_value=True) as compare_digest:
            self.assertTrue(handshake.verify_finished(b"v" * 12, "client finished"))

        compare_digest.assert_called_once_with(b"v" * 12, b"v" * 12)

        self.assertFalse(handshake.verify_finished(b"x" * 12, "client finished"))


if __name__ == "__main__":
    unittest.main()

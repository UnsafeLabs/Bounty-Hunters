import hmac
import unittest
from unittest.mock import patch

from python.tls_handshake import TLSHandshake


class TLSVerifyFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_hmac_compare_digest(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48
        received_verify = b"v" * 12

        with patch(
            "python.tls_handshake.hmac.compare_digest",
            wraps=hmac.compare_digest,
        ) as compare_digest:
            handshake.verify_finished(received_verify, "client finished")

        compare_digest.assert_called_once()
        computed_verify, compared_received = compare_digest.call_args.args
        self.assertEqual(compared_received, received_verify)
        self.assertEqual(len(computed_verify), 12)


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest import mock

from tls_handshake import TLSHandshake


class FinishedVerificationTests(unittest.TestCase):
    def test_verify_finished_uses_compare_digest(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48

        with mock.patch(
            "tls_handshake.hmac.compare_digest", return_value=False
        ) as compare_digest:
            result = handshake.verify_finished(b"received", "client finished")

        self.assertFalse(result)
        compare_digest.assert_called_once()
        self.assertEqual(compare_digest.call_args.args[1], b"received")
        self.assertIsInstance(result, bool)


if __name__ == "__main__":
    unittest.main()

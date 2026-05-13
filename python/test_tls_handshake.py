import unittest
from unittest import mock

from tls_handshake import TLSHandshake


class VerifyFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_compare(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master-secret"

        with mock.patch(
            "tls_handshake.hmac.compare_digest",
            return_value=True,
        ) as compare_digest:
            self.assertTrue(handshake.verify_finished(b"received-verify", "client finished"))

        compare_digest.assert_called_once()
        computed_verify, received_verify = compare_digest.call_args.args
        self.assertEqual(received_verify, b"received-verify")
        self.assertIsInstance(computed_verify, bytes)

    def test_verify_finished_preserves_bool_result(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"master-secret"

        expected = handshake._prf(
            handshake.master_secret,
            b"client finished",
            handshake.handshake_hash.copy().digest(),
            12,
        )

        self.assertTrue(handshake.verify_finished(expected, "client finished"))
        mismatch = expected[:-1] + bytes([expected[-1] ^ 0x01])
        self.assertFalse(handshake.verify_finished(mismatch, "client finished"))


if __name__ == "__main__":
    unittest.main()

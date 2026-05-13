import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class VerifyFinishedTests(unittest.TestCase):
    def make_handshake(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48
        handshake.handshake_hash.update(b"client hello")
        return handshake

    def test_verify_finished_returns_true_for_matching_verify_data(self):
        handshake = self.make_handshake()
        transcript_hash = handshake.handshake_hash.copy().digest()
        verify_data = handshake._prf(
            handshake.master_secret,
            b"client finished",
            transcript_hash,
            12,
        )

        self.assertTrue(handshake.verify_finished(verify_data, "client finished"))

    def test_verify_finished_returns_false_for_mismatched_verify_data(self):
        handshake = self.make_handshake()
        transcript_hash = handshake.handshake_hash.copy().digest()
        verify_data = bytearray(
            handshake._prf(
                handshake.master_secret,
                b"client finished",
                transcript_hash,
                12,
            )
        )
        verify_data[-1] ^= 0xFF

        self.assertFalse(
            handshake.verify_finished(bytes(verify_data), "client finished")
        )

    def test_verify_finished_uses_constant_time_compare_digest(self):
        handshake = self.make_handshake()
        received_verify = b"\x00" * 12

        with patch("tls_handshake.hmac.compare_digest", return_value=False) as compare:
            self.assertFalse(
                handshake.verify_finished(received_verify, "client finished")
            )

        computed_verify = handshake._prf(
            handshake.master_secret,
            b"client finished",
            handshake.handshake_hash.copy().digest(),
            12,
        )
        compare.assert_called_once_with(computed_verify, received_verify)


if __name__ == "__main__":
    unittest.main()

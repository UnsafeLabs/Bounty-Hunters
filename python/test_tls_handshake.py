import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tls_handshake import TLSHandshake


class MasterSecretDerivationTests(unittest.TestCase):
    def _handshake(self, negotiated_ems=False):
        handshake = TLSHandshake()
        handshake.negotiated_ems = negotiated_ems
        handshake._pre_master_secret = bytes(range(48))
        handshake.client_random = bytes(range(32))
        handshake.server_random = bytes(range(32, 64))
        return handshake

    def test_non_ems_uses_standard_master_secret_label(self):
        handshake = self._handshake(negotiated_ems=False)

        handshake._derive_master_secret()

        expected = handshake._prf(
            handshake._pre_master_secret,
            b"master secret",
            handshake.client_random + handshake.server_random,
            48,
        )
        self.assertEqual(handshake.master_secret, expected)
        self.assertEqual(len(handshake.master_secret), 48)

    def test_ems_uses_extended_master_secret_label(self):
        handshake = self._handshake(negotiated_ems=True)

        handshake._derive_master_secret()

        expected = handshake._prf(
            handshake._pre_master_secret,
            b"extended master secret",
            handshake.client_random + handshake.server_random,
            48,
        )
        standard = handshake._prf(
            handshake._pre_master_secret,
            b"master secret",
            handshake.client_random + handshake.server_random,
            48,
        )
        self.assertEqual(handshake.master_secret, expected)
        self.assertNotEqual(handshake.master_secret, standard)
        self.assertEqual(len(handshake.master_secret), 48)


if __name__ == "__main__":
    unittest.main()

import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class DeriveMasterSecretTests(unittest.TestCase):
    def make_handshake(self, negotiated_ems):
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.negotiated_ems = negotiated_ems
        return handshake

    def test_ems_uses_extended_master_secret_prf_label(self):
        handshake = self.make_handshake(negotiated_ems=True)

        with patch.object(
            handshake, "_prf", return_value=b"m" * 48
        ) as prf:
            handshake._derive_master_secret()

        prf.assert_called_once_with(
            handshake._pre_master_secret,
            b"extended master secret",
            handshake.client_random + handshake.server_random,
            48,
        )
        self.assertEqual(handshake.master_secret, b"m" * 48)

    def test_non_ems_keeps_master_secret_prf_label(self):
        handshake = self.make_handshake(negotiated_ems=False)

        with patch.object(
            handshake, "_prf", return_value=b"m" * 48
        ) as prf:
            handshake._derive_master_secret()

        prf.assert_called_once_with(
            handshake._pre_master_secret,
            b"master secret",
            handshake.client_random + handshake.server_random,
            48,
        )

    def test_ems_and_non_ems_master_secrets_differ(self):
        ems = self.make_handshake(negotiated_ems=True)
        non_ems = self.make_handshake(negotiated_ems=False)

        ems._derive_master_secret()
        non_ems._derive_master_secret()

        self.assertEqual(len(ems.master_secret), 48)
        self.assertEqual(len(non_ems.master_secret), 48)
        self.assertNotEqual(ems.master_secret, non_ems.master_secret)


if __name__ == "__main__":
    unittest.main()

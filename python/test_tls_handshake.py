"""Tests for _derive_master_secret EMS label fix (issue #21)."""

import unittest

from tls_handshake import TLSHandshake


class TestDeriveMasterSecret(unittest.TestCase):
    """Tests for _derive_master_secret() EMS label fix (issue #21)."""

    def setUp(self):
        self.handshake = TLSHandshake(is_server=False)
        self.handshake.client_random = b"\x00" * 32
        self.handshake.server_random = b"\x01" * 32
        self.handshake._pre_master_secret = b"\x02" * 48

    def test_ems_label(self):
        """When EMS is negotiated, label is 'extended master secret'."""
        self.handshake.negotiated_ems = True
        self.handshake._derive_master_secret()
        seed = self.handshake.client_random + self.handshake.server_random
        expected = self.handshake._prf(
            self.handshake._pre_master_secret,
            b"extended master secret",
            seed,
            48,
        )
        self.assertEqual(self.handshake.master_secret, expected)

    def test_non_ems_label(self):
        """When EMS is not negotiated, label remains 'master secret'."""
        self.handshake.negotiated_ems = False
        self.handshake._derive_master_secret()
        seed = self.handshake.client_random + self.handshake.server_random
        expected = self.handshake._prf(
            self.handshake._pre_master_secret,
            b"master secret",
            seed,
            48,
        )
        self.assertEqual(self.handshake.master_secret, expected)

    def test_ems_produces_different_secret(self):
        """EMS and non-EMS produce different master secrets."""
        self.handshake.negotiated_ems = False
        self.handshake._derive_master_secret()
        non_ems_secret = self.handshake.master_secret

        self.handshake.negotiated_ems = True
        self.handshake._derive_master_secret()
        ems_secret = self.handshake.master_secret

        self.assertNotEqual(non_ems_secret, ems_secret)


if __name__ == "__main__":
    unittest.main()

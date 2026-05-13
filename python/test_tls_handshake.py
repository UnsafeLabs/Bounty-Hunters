import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class MasterSecretDerivationTests(unittest.TestCase):
    def setUp(self):
        self.handshake = TLSHandshake()
        self.handshake._pre_master_secret = b"p" * 48
        self.handshake.client_random = b"c" * 32
        self.handshake.server_random = b"s" * 32

    def test_ems_uses_extended_master_secret_label(self):
        self.handshake.negotiated_ems = True

        with patch.object(self.handshake, "_prf", return_value=b"m" * 48) as prf:
            self.handshake._derive_master_secret()

        prf.assert_called_once_with(
            self.handshake._pre_master_secret,
            b"extended master secret",
            self.handshake.client_random + self.handshake.server_random,
            48,
        )

    def test_non_ems_uses_standard_master_secret_label(self):
        self.handshake.negotiated_ems = False

        with patch.object(self.handshake, "_prf", return_value=b"m" * 48) as prf:
            self.handshake._derive_master_secret()

        prf.assert_called_once_with(
            self.handshake._pre_master_secret,
            b"master secret",
            self.handshake.client_random + self.handshake.server_random,
            48,
        )


if __name__ == "__main__":
    unittest.main()

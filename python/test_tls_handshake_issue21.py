import unittest
from unittest.mock import patch

from tls_handshake import TLSHandshake


class ExtendedMasterSecretTests(unittest.TestCase):
    def test_ems_uses_extended_master_secret_label(self):
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.negotiated_ems = True

        with patch.object(handshake, "_prf", return_value=b"m" * 48) as prf:
            handshake._derive_master_secret()

        self.assertEqual(prf.call_args.args[1], b"extended master secret")
        self.assertEqual(handshake.master_secret, b"m" * 48)

    def test_non_ems_keeps_standard_master_secret_label(self):
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.negotiated_ems = False

        with patch.object(handshake, "_prf", return_value=b"m" * 48) as prf:
            handshake._derive_master_secret()

        self.assertEqual(prf.call_args.args[1], b"master secret")


if __name__ == "__main__":
    unittest.main()

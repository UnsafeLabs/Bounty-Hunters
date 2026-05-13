import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import TLSHandshake


class TLSHandshakeMasterSecretTests(unittest.TestCase):
    def _configured_handshake(self, negotiated_ems):
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.negotiated_ems = negotiated_ems
        return handshake

    def test_ems_uses_extended_master_secret_label(self):
        handshake = self._configured_handshake(negotiated_ems=True)

        with patch.object(handshake, "_prf", return_value=b"x" * 48) as prf:
            handshake._derive_master_secret()

        self.assertEqual(prf.call_args.args[1], b"extended master secret")

    def test_non_ems_keeps_standard_master_secret_label(self):
        handshake = self._configured_handshake(negotiated_ems=False)

        with patch.object(handshake, "_prf", return_value=b"x" * 48) as prf:
            handshake._derive_master_secret()

        self.assertEqual(prf.call_args.args[1], b"master secret")

    def test_ems_and_non_ems_generate_different_master_secrets(self):
        ems_handshake = self._configured_handshake(negotiated_ems=True)
        standard_handshake = self._configured_handshake(negotiated_ems=False)

        ems_handshake._derive_master_secret()
        standard_handshake._derive_master_secret()

        self.assertEqual(len(ems_handshake.master_secret), 48)
        self.assertEqual(len(standard_handshake.master_secret), 48)
        self.assertNotEqual(
            ems_handshake.master_secret,
            standard_handshake.master_secret,
        )


if __name__ == "__main__":
    unittest.main()

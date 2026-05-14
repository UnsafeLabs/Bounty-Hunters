import unittest
from unittest.mock import patch

from python.tls_handshake import TLSHandshake


class TLSExtendedMasterSecretTests(unittest.TestCase):
    def _handshake(self):
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"p" * 48
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake.handshake_hash.update(b"client/server transcript")
        return handshake

    def test_ems_uses_extended_master_secret_label_and_session_hash_seed(self):
        handshake = self._handshake()
        handshake.negotiated_ems = True
        session_hash = handshake.handshake_hash.copy().digest()

        with patch.object(handshake, "_prf", return_value=b"m" * 48) as prf:
            handshake._derive_master_secret()

        prf.assert_called_once_with(
            handshake._pre_master_secret,
            b"extended master secret",
            session_hash,
            48,
        )

    def test_non_ems_uses_master_secret_label_and_random_seed(self):
        handshake = self._handshake()
        handshake.negotiated_ems = False

        with patch.object(handshake, "_prf", return_value=b"m" * 48) as prf:
            handshake._derive_master_secret()

        prf.assert_called_once_with(
            handshake._pre_master_secret,
            b"master secret",
            handshake.client_random + handshake.server_random,
            48,
        )


if __name__ == "__main__":
    unittest.main()

import unittest

from tls_handshake import TLSHandshake


class ExtendedMasterSecretTests(unittest.TestCase):
    def test_ems_uses_extended_master_secret_label(self):
        labels = []
        handshake = TLSHandshake()
        handshake.negotiated_ems = True
        handshake.client_random = b"c" * 32
        handshake.server_random = b"s" * 32
        handshake._pre_master_secret = b"p" * 48
        handshake._prf = lambda secret, label, seed, length: labels.append(label) or (b"m" * length)

        handshake._derive_master_secret()

        self.assertEqual([b"extended master secret"], labels)
        self.assertEqual(b"m" * 48, handshake.master_secret)


if __name__ == "__main__":
    unittest.main()
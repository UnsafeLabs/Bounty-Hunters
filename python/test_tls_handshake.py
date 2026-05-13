import unittest

from tls_handshake import TLSHandshake


class RecordingTLSHandshake(TLSHandshake):
    def __init__(self):
        super().__init__()
        self.prf_labels = []

    def _prf(self, secret, label, seed, output_len):
        self.prf_labels.append(label)
        return super()._prf(secret, label, seed, output_len)


def configured_handshake(ems_enabled):
    handshake = RecordingTLSHandshake()
    handshake._pre_master_secret = b"p" * 48
    handshake.client_random = b"c" * 32
    handshake.server_random = b"s" * 32
    handshake.negotiated_ems = ems_enabled
    return handshake


class MasterSecretDerivationTests(unittest.TestCase):
    def test_non_ems_uses_standard_master_secret_label(self):
        handshake = configured_handshake(ems_enabled=False)

        handshake._derive_master_secret()

        self.assertEqual(handshake.prf_labels[-1], b"master secret")
        self.assertEqual(len(handshake.master_secret), 48)

    def test_ems_uses_extended_master_secret_label(self):
        handshake = configured_handshake(ems_enabled=True)

        handshake._derive_master_secret()

        self.assertEqual(handshake.prf_labels[-1], b"extended master secret")
        self.assertEqual(len(handshake.master_secret), 48)

    def test_ems_and_non_ems_master_secrets_differ(self):
        standard = configured_handshake(ems_enabled=False)
        extended = configured_handshake(ems_enabled=True)

        standard._derive_master_secret()
        extended._derive_master_secret()

        self.assertNotEqual(standard.master_secret, extended.master_secret)


if __name__ == "__main__":
    unittest.main()

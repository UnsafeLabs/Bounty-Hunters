import unittest

from tls_handshake import TLSHandshake


def build_handshake(negotiated_ems=False):
    handshake = TLSHandshake()
    handshake._pre_master_secret = b"p" * 48
    handshake.client_random = b"c" * 32
    handshake.server_random = b"s" * 32
    handshake.negotiated_ems = negotiated_ems
    return handshake


class ExtendedMasterSecretTests(unittest.TestCase):
    def test_derive_master_secret_uses_ems_label_when_negotiated(self):
        labels = []
        handshake = build_handshake(negotiated_ems=True)

        def capture_prf(secret, label, seed, output_len):
            labels.append(label)
            return b"x" * output_len

        handshake._prf = capture_prf
        handshake._derive_master_secret()

        self.assertEqual(labels, [b"extended master secret"])

    def test_derive_master_secret_keeps_standard_label_without_ems(self):
        labels = []
        handshake = build_handshake(negotiated_ems=False)

        def capture_prf(secret, label, seed, output_len):
            labels.append(label)
            return b"x" * output_len

        handshake._prf = capture_prf
        handshake._derive_master_secret()

        self.assertEqual(labels, [b"master secret"])

    def test_ems_and_standard_master_secrets_differ(self):
        standard = build_handshake(negotiated_ems=False)
        ems = build_handshake(negotiated_ems=True)

        standard._derive_master_secret()
        ems._derive_master_secret()

        self.assertEqual(len(standard.master_secret), 48)
        self.assertEqual(len(ems.master_secret), 48)
        self.assertNotEqual(standard.master_secret, ems.master_secret)


if __name__ == "__main__":
    unittest.main()

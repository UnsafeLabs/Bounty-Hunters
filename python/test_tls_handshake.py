import unittest

from tls_handshake import TLSHandshake


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_derive_master_secret_uses_ems_label_when_negotiated(self):
        class RecordingHandshake(TLSHandshake):
            def __init__(self, negotiated_ems):
                super().__init__()
                self.negotiated_ems = negotiated_ems
                self._pre_master_secret = b"p" * 48
                self.client_random = b"c" * 32
                self.server_random = b"s" * 32
                self.labels = []

            def _prf(self, secret, label, seed, output_len):
                self.labels.append(label)
                return bytes([len(label) % 256]) * output_len

        standard = RecordingHandshake(False)
        standard._derive_master_secret()
        ems = RecordingHandshake(True)
        ems._derive_master_secret()

        self.assertEqual(standard.labels[-1], b"master secret")
        self.assertEqual(ems.labels[-1], b"extended master secret")
        self.assertNotEqual(standard.master_secret, ems.master_secret)


if __name__ == "__main__":
    unittest.main()

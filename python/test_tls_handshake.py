"""Regression tests for _derive_master_secret() EMS label (issue #21)."""

import unittest

from tls_handshake import TLSHandshake


class DeriveMasterSecretLabelTests(unittest.TestCase):
    def _prepare(self, ems: bool) -> TLSHandshake:
        handshake = TLSHandshake()
        handshake._pre_master_secret = b"\x42" * 48
        handshake.client_random = b"\x01" * 32
        handshake.server_random = b"\x02" * 32
        handshake.negotiated_ems = ems
        return handshake

    def test_non_ems_path_uses_master_secret_label(self):
        handshake = self._prepare(ems=False)
        captured = {}
        original_prf = handshake._prf

        def capturing_prf(secret, label, seed, length):
            captured["label"] = label
            return original_prf(secret, label, seed, length)

        handshake._prf = capturing_prf
        handshake._derive_master_secret()

        self.assertEqual(captured["label"], b"master secret")
        self.assertEqual(len(handshake.master_secret), 48)

    def test_ems_path_uses_extended_master_secret_label(self):
        handshake = self._prepare(ems=True)
        captured = {}
        original_prf = handshake._prf

        def capturing_prf(secret, label, seed, length):
            captured["label"] = label
            return original_prf(secret, label, seed, length)

        handshake._prf = capturing_prf
        handshake._derive_master_secret()

        self.assertEqual(captured["label"], b"extended master secret")
        self.assertEqual(len(handshake.master_secret), 48)

    def test_ems_and_non_ems_produce_distinct_master_secrets(self):
        non_ems = self._prepare(ems=False)
        non_ems._derive_master_secret()

        ems = self._prepare(ems=True)
        ems._derive_master_secret()

        self.assertNotEqual(non_ems.master_secret, ems.master_secret)


if __name__ == "__main__":
    unittest.main()

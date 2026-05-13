import unittest

from tls_handshake import TLSHandshake


class TLSHandshakeTests(unittest.TestCase):
    def test_extended_master_secret_uses_distinct_prf_label(self):
        pre_master_secret = bytes(range(48))
        client_random = b"c" * 32
        server_random = b"s" * 32

        standard = TLSHandshake()
        standard._pre_master_secret = pre_master_secret
        standard.client_random = client_random
        standard.server_random = server_random
        standard.negotiated_ems = False
        standard._derive_master_secret()

        extended = TLSHandshake()
        extended._pre_master_secret = pre_master_secret
        extended.client_random = client_random
        extended.server_random = server_random
        extended.negotiated_ems = True
        extended._derive_master_secret()

        expected_extended_secret = extended._prf(
            pre_master_secret,
            b"extended master secret",
            client_random + server_random,
            48,
        )

        self.assertEqual(extended.master_secret, expected_extended_secret)
        self.assertNotEqual(extended.master_secret, standard.master_secret)


if __name__ == "__main__":
    unittest.main()

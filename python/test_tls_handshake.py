import unittest

from tls_handshake import EXT_SNI, TLSHandshake


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_parse_extensions_decodes_sni_hostname(self):
        hostname = b"api.example.test"
        sni_entry = b"\x00" + len(hostname).to_bytes(2, "big") + hostname
        sni_list = len(sni_entry).to_bytes(2, "big") + sni_entry
        extension = (
            EXT_SNI.to_bytes(2, "big")
            + len(sni_list).to_bytes(2, "big")
            + sni_list
        )
        handshake = TLSHandshake()

        parsed = handshake.parse_extensions(extension)

        self.assertEqual(parsed[0].server_name, "api.example.test")
        self.assertEqual(handshake.server_name, "api.example.test")

    def test_parse_extensions_without_sni_keeps_hostname_empty(self):
        handshake = TLSHandshake()

        handshake.parse_extensions(b"")

        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

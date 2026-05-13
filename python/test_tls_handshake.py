import struct
import unittest

from tls_handshake import EXT_EXTENDED_MASTER_SECRET, EXT_SNI, TLSHandshake


class SNIParsingTests(unittest.TestCase):
    def test_parse_extensions_decodes_sni_host_name(self):
        hostname = b"example.com"
        sni_data = (
            struct.pack("!H", len(hostname) + 3)
            + b"\x00"
            + struct.pack("!H", len(hostname))
            + hostname
        )
        extension_data = (
            struct.pack("!HH", EXT_SNI, len(sni_data))
            + sni_data
        )

        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(extension_data)

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_no_sni_leaves_server_name_none(self):
        extension_data = struct.pack("!HH", EXT_EXTENDED_MASTER_SECRET, 0)

        handshake = TLSHandshake()
        handshake.parse_extensions(extension_data)

        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

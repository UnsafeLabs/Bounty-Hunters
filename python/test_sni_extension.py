import struct
import unittest

from tls_handshake import EXT_EXTENDED_MASTER_SECRET, EXT_SNI, TLSHandshake


class SNIExtensionParsingTests(unittest.TestCase):
    def test_parse_extensions_decodes_sni_hostname(self):
        hostname = b"example.com"
        server_name = b"\x00" + struct.pack("!H", len(hostname)) + hostname
        sni_data = struct.pack("!H", len(server_name)) + server_name
        extension_block = struct.pack("!HH", EXT_SNI, len(sni_data)) + sni_data

        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(extension_block)

        self.assertEqual("example.com", extensions[0].server_name)
        self.assertEqual("example.com", handshake.server_name)

    def test_parse_extensions_without_sni_leaves_server_name_unset(self):
        extension_block = struct.pack("!HH", EXT_EXTENDED_MASTER_SECRET, 0)

        handshake = TLSHandshake()
        handshake.parse_extensions(extension_block)

        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()
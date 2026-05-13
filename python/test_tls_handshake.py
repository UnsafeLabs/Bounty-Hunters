import struct
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import EXT_SNI, TLSHandshake


class TLSHandshakeSniExtensionTests(unittest.TestCase):
    def test_parse_sni_extension_sets_server_name(self):
        hostname = b"example.com"
        server_name = b"\x00" + struct.pack("!H", len(hostname)) + hostname
        ext_data = struct.pack("!H", len(server_name)) + server_name
        extension = struct.pack("!HH", EXT_SNI, len(ext_data)) + ext_data

        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(extension)

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_parse_extensions_without_sni_leaves_server_name_unset(self):
        handshake = TLSHandshake()

        self.assertEqual(handshake.parse_extensions(b""), [])
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

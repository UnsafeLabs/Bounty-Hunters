import struct
import unittest

from tls_handshake import (
    EXT_EXTENDED_MASTER_SECRET,
    EXT_SNI,
    TLSHandshake,
)


def build_extension(ext_type, payload):
    return struct.pack("!HH", ext_type, len(payload)) + payload


class SNIExtensionTests(unittest.TestCase):
    def test_parse_extensions_extracts_sni_host_name(self):
        hostname = b"example.com"
        sni_entry = b"\x00" + struct.pack("!H", len(hostname)) + hostname
        sni_payload = struct.pack("!H", len(sni_entry)) + sni_entry

        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(
            build_extension(EXT_SNI, sni_payload)
        )

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_parse_extensions_without_sni_leaves_server_name_unset(self):
        handshake = TLSHandshake()

        handshake.parse_extensions(
            build_extension(EXT_EXTENDED_MASTER_SECRET, b"")
        )

        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

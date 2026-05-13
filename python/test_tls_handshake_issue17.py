import struct
import unittest

from tls_handshake import EXT_SNI, TLSHandshake


def sni_extension_data(hostname: str) -> bytes:
    host = hostname.encode("idna")
    server_name = b"\x00" + struct.pack("!H", len(host)) + host
    return struct.pack("!H", len(server_name)) + server_name


class SNIParsingTests(unittest.TestCase):
    def test_parse_extensions_extracts_sni_server_name(self):
        handshake = TLSHandshake()
        ext_payload = sni_extension_data("example.com")
        extension_bytes = (
            struct.pack("!H", EXT_SNI)
            + struct.pack("!H", len(ext_payload))
            + ext_payload
        )

        extensions = handshake.parse_extensions(extension_bytes)

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")
        self.assertIs(handshake.extensions[EXT_SNI], extensions[0])

    def test_malformed_sni_extension_is_ignored(self):
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(
            struct.pack("!H", EXT_SNI) + struct.pack("!H", 2) + b"\x00\x10"
        )

        self.assertIsNone(extensions[0].server_name)
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

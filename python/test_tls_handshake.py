import struct
import unittest

from tls_handshake import EXT_EXTENDED_MASTER_SECRET, EXT_SNI, TLSHandshake


def extension(ext_type: int, data: bytes) -> bytes:
    return struct.pack("!HH", ext_type, len(data)) + data


def sni_extension_data(hostname: str) -> bytes:
    host_bytes = hostname.encode("ascii")
    server_name = b"\x00" + struct.pack("!H", len(host_bytes)) + host_bytes
    return struct.pack("!H", len(server_name)) + server_name


class SNIParsingTests(unittest.TestCase):
    def test_parse_extensions_decodes_sni_host_name(self) -> None:
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(
            extension(EXT_SNI, sni_extension_data("example.com"))
        )

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_parse_extensions_without_sni_leaves_server_name_empty(self) -> None:
        handshake = TLSHandshake()

        handshake.parse_extensions(extension(EXT_EXTENDED_MASTER_SECRET, b""))

        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

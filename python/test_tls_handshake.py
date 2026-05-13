import struct
import unittest

from tls_handshake import EXT_SNI, HandshakeMessage, HandshakeType, TLSHandshake


def make_extension(ext_type, data):
    return struct.pack("!HH", ext_type, len(data)) + data


def make_sni_payload(hostname):
    hostname_bytes = hostname.encode("ascii")
    server_name = b"\x00" + struct.pack("!H", len(hostname_bytes)) + hostname_bytes
    return struct.pack("!H", len(server_name)) + server_name


def make_client_hello_payload(extensions=b""):
    payload = (
        b"\x03\x03"
        + b"c" * 32
        + b"\x00"
        + struct.pack("!H", 2)
        + b"\x00\x2f"
        + b"\x01\x00"
    )
    if extensions:
        payload += struct.pack("!H", len(extensions)) + extensions
    return payload


class SNIExtensionTests(unittest.TestCase):
    def test_parse_extensions_decodes_sni_hostname(self):
        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(
            make_extension(EXT_SNI, make_sni_payload("example.com"))
        )

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_no_sni_extension_leaves_server_name_none(self):
        handshake = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_HELLO, make_client_hello_payload()
        )

        self.assertTrue(handshake.parse_client_hello(message))
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

import struct
import unittest

from python.tls_handshake import EXT_SNI, TLSHandshake


def sni_extension(hostname: str) -> bytes:
    name = hostname.encode("idna")
    server_name = b"\x00" + struct.pack("!H", len(name)) + name
    return struct.pack("!H", len(server_name)) + server_name


def client_hello_with_extensions(extensions: bytes) -> bytes:
    payload = bytearray()
    payload.extend(b"\x03\x03")
    payload.extend(bytes(range(32)))
    payload.append(0)  # empty session id
    payload.extend(struct.pack("!H", 2))
    payload.extend(b"\x00/" )  # TLS_RSA_WITH_AES_128_CBC_SHA
    payload.append(1)
    payload.append(0)  # null compression
    payload.extend(struct.pack("!H", len(extensions)))
    payload.extend(extensions)
    return bytes(payload)


class SNITest(unittest.TestCase):
    def test_parse_extensions_extracts_sni_host_name(self):
        ext_data = sni_extension("example.com")
        raw_extensions = struct.pack("!HH", EXT_SNI, len(ext_data)) + ext_data
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(raw_extensions)

        self.assertEqual(1, len(extensions))
        self.assertEqual("example.com", extensions[0].server_name)
        self.assertEqual("example.com", handshake.server_name)
        self.assertIs(handshake.extensions[EXT_SNI], extensions[0])

    def test_parse_client_hello_populates_server_name(self):
        ext_data = sni_extension("api.example.test")
        raw_extensions = struct.pack("!HH", EXT_SNI, len(ext_data)) + ext_data
        handshake = TLSHandshake()
        message = type("Message", (), {})()
        message.payload = client_hello_with_extensions(raw_extensions)
        message.extensions = []

        self.assertTrue(handshake.parse_client_hello(message))

        self.assertEqual("api.example.test", handshake.server_name)
        self.assertEqual("api.example.test", message.extensions[0].server_name)

    def test_malformed_sni_does_not_set_server_name(self):
        # Advertise a longer server_name_list than the extension contains.
        malformed = b"\x00\x10\x00\x00\x0bexample.com"
        raw_extensions = struct.pack("!HH", EXT_SNI, len(malformed)) + malformed
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(raw_extensions)

        self.assertEqual(1, len(extensions))
        self.assertIsNone(extensions[0].server_name)
        self.assertIsNone(handshake.server_name)

    def test_non_host_name_entries_are_ignored(self):
        name = b"ignored"
        server_name = b"\x01" + struct.pack("!H", len(name)) + name
        ext_data = struct.pack("!H", len(server_name)) + server_name
        raw_extensions = struct.pack("!HH", EXT_SNI, len(ext_data)) + ext_data
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(raw_extensions)

        self.assertIsNone(extensions[0].server_name)
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from tls_handshake import EXT_SNI, TLSHandshake  # noqa: E402


def sni_extension(hostname: str) -> bytes:
    host_bytes = hostname.encode("ascii")
    server_name = b"\x00" + struct.pack("!H", len(host_bytes)) + host_bytes
    server_name_list = struct.pack("!H", len(server_name)) + server_name
    return struct.pack("!HH", EXT_SNI, len(server_name_list)) + server_name_list


def client_hello_record(hostname: str) -> bytes:
    extensions = sni_extension(hostname)
    payload = b"".join(
        [
            b"\x03\x03",  # client version
            b"\x01" * 32,  # client random
            b"\x00",  # empty session id
            b"\x00\x02\x13\x01",  # one cipher suite
            b"\x01\x00",  # null compression
            struct.pack("!H", len(extensions)),
            extensions,
        ]
    )
    handshake = b"\x01" + len(payload).to_bytes(3, "big") + payload
    return b"\x16\x03\x03" + struct.pack("!H", len(handshake)) + handshake


class TLSHandshakeSNITest(unittest.TestCase):
    def test_parse_extensions_extracts_sni_server_name(self):
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(sni_extension("example.com"))

        self.assertEqual(len(extensions), 1)
        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")
        self.assertEqual(handshake.extensions[EXT_SNI].server_name, "example.com")

    def test_client_hello_state_info_reports_sni_server_name(self):
        handshake = TLSHandshake()

        ok, message = handshake.process_message(client_hello_record("api.example.com"))

        self.assertTrue(ok, message)
        self.assertEqual(handshake.get_state_info()["server_name"], "api.example.com")

    def test_malformed_sni_extension_does_not_set_server_name(self):
        malformed_sni = struct.pack("!HH", EXT_SNI, 4) + b"\x00\xff\x00\x01"
        handshake = TLSHandshake()

        extensions = handshake.parse_extensions(malformed_sni)

        self.assertEqual(len(extensions), 1)
        self.assertIsNone(extensions[0].server_name)
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

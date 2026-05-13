"""Regression tests for parse_extensions() SNI handling (issue #17)."""

import struct
import unittest

from tls_handshake import EXT_SNI, EXT_EXTENDED_MASTER_SECRET, TLSHandshake


def _build_sni_extension(hostname: str) -> bytes:
    name_bytes = hostname.encode("ascii")
    server_name = bytes([0x00]) + struct.pack("!H", len(name_bytes)) + name_bytes
    server_name_list = struct.pack("!H", len(server_name)) + server_name
    ext_header = struct.pack("!HH", EXT_SNI, len(server_name_list))
    return ext_header + server_name_list


def _build_ems_extension() -> bytes:
    return struct.pack("!HH", EXT_EXTENDED_MASTER_SECRET, 0)


class ParseExtensionsSNITests(unittest.TestCase):
    def test_sni_hostname_decoded(self):
        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(_build_sni_extension("example.com"))

        self.assertEqual(handshake.server_name, "example.com")
        sni_ext = next(ext for ext in extensions if ext.ext_type == EXT_SNI)
        self.assertEqual(sni_ext.server_name, "example.com")

    def test_no_sni_leaves_server_name_none(self):
        handshake = TLSHandshake()
        handshake.parse_extensions(_build_ems_extension())

        self.assertIsNone(handshake.server_name)
        self.assertTrue(handshake.negotiated_ems)

    def test_non_host_name_entry_ignored(self):
        # name_type 0x01 is reserved and must not populate server_name.
        custom_entry = bytes([0x01]) + struct.pack("!H", 4) + b"\x00\x01\x02\x03"
        list_payload = struct.pack("!H", len(custom_entry)) + custom_entry
        ext_data = struct.pack("!HH", EXT_SNI, len(list_payload)) + list_payload

        handshake = TLSHandshake()
        handshake.parse_extensions(ext_data)

        self.assertIsNone(handshake.server_name)

    def test_sni_alongside_ems(self):
        handshake = TLSHandshake()
        handshake.parse_extensions(
            _build_sni_extension("api.example.org") + _build_ems_extension()
        )

        self.assertEqual(handshake.server_name, "api.example.org")
        self.assertTrue(handshake.negotiated_ems)


if __name__ == "__main__":
    unittest.main()

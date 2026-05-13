from tls_handshake import TLSHandshake, EXT_SNI
import struct


def build_sni_ext(hostname: str) -> bytes:
    host = hostname.encode("ascii")
    server_name = b"\x00" + struct.pack("!H", len(host)) + host
    sni_list = struct.pack("!H", len(server_name)) + server_name
    return struct.pack("!HH", EXT_SNI, len(sni_list)) + sni_list


def test_parse_extensions_decodes_sni_hostname():
    hs = TLSHandshake()
    extensions = hs.parse_extensions(build_sni_ext("example.com"))
    assert extensions[0].server_name == "example.com"
    assert hs.server_name == "example.com"


def test_no_sni_leaves_server_name_none():
    hs = TLSHandshake()
    # Extended master secret extension with zero-length data
    hs.parse_extensions(struct.pack("!HH", 0x0017, 0))
    assert hs.server_name is None


if __name__ == "__main__":
    test_parse_extensions_decodes_sni_hostname()
    test_no_sni_leaves_server_name_none()
    print("issue #17 tests passed")

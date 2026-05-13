#!/usr/bin/env python3
"""
Test suite for issue #17: Add SNI extension parsing in parse_extensions()

Acceptance Criteria:
- parse_extensions() adds an elif branch for EXT_SNI that decodes the SNI list per RFC 6066
- After parsing, ext.server_name and self.server_name equal the decoded hostname string
- A ClientHello with no SNI extension leaves self.server_name as None
- All existing tests still pass
- Add new tests covering the fixed bugs
"""

import struct
from tls_handshake import TLSHandshake, EXT_SNI, EXT_EXTENDED_MASTER_SECRET


def build_sni_extension_data(hostname: str) -> bytes:
    """Build RFC 6066 SNI extension data for a host_name entry."""
    hostname_bytes = hostname.encode('ascii')
    name_entry = b'\x00' + struct.pack('!H', len(hostname_bytes)) + hostname_bytes
    return struct.pack('!H', len(name_entry)) + name_entry


def build_extension(ext_type: int, data: bytes) -> bytes:
    """Build TLS extension wire format."""
    return struct.pack('!HH', ext_type, len(data)) + data


def test_sni_extension_decodes_hostname():
    tls = TLSHandshake()
    hostname = "example.com"
    ext_data = build_sni_extension_data(hostname)
    extensions_data = build_extension(EXT_SNI, ext_data)
    
    extensions = tls.parse_extensions(extensions_data)
    
    assert len(extensions) == 1
    assert extensions[0].ext_type == EXT_SNI
    assert extensions[0].server_name == hostname
    assert tls.server_name == hostname
    print("✓ SNI extension decodes hostname to ext.server_name and self.server_name")


def test_no_sni_leaves_server_name_none():
    tls = TLSHandshake()
    ems_data = b''
    extensions_data = build_extension(EXT_EXTENDED_MASTER_SECRET, ems_data)
    
    extensions = tls.parse_extensions(extensions_data)
    
    assert len(extensions) == 1
    assert tls.server_name is None
    assert extensions[0].server_name is None
    print("✓ ClientHello with no SNI leaves self.server_name as None")


def test_sni_with_different_hostname():
    tls = TLSHandshake()
    hostname = "api.example.org"
    ext_data = build_sni_extension_data(hostname)
    extensions_data = build_extension(EXT_SNI, ext_data)
    
    extensions = tls.parse_extensions(extensions_data)
    
    assert extensions[0].server_name == hostname
    assert tls.server_name == hostname
    print("✓ SNI parsing works with arbitrary hostname")


def test_malformed_sni_does_not_crash():
    tls = TLSHandshake()
    malformed_data = b'\x00\x10\x00\x00'  # Declares longer list than available
    extensions_data = build_extension(EXT_SNI, malformed_data)
    
    extensions = tls.parse_extensions(extensions_data)
    
    assert len(extensions) == 1
    assert extensions[0].server_name is None
    assert tls.server_name is None
    print("✓ Malformed SNI extension does not crash and leaves server_name None")


def test_non_host_name_type_ignored():
    tls = TLSHandshake()
    hostname_bytes = b"example.com"
    # name_type 0x01 is not host_name
    name_entry = b'\x01' + struct.pack('!H', len(hostname_bytes)) + hostname_bytes
    ext_data = struct.pack('!H', len(name_entry)) + name_entry
    extensions_data = build_extension(EXT_SNI, ext_data)
    
    extensions = tls.parse_extensions(extensions_data)
    
    assert extensions[0].server_name is None
    assert tls.server_name is None
    print("✓ Non-host_name SNI entry is ignored")


if __name__ == "__main__":
    test_sni_extension_decodes_hostname()
    test_no_sni_leaves_server_name_none()
    test_sni_with_different_hostname()
    test_malformed_sni_does_not_crash()
    test_non_host_name_type_ignored()
    print("\n✅ All tests passed!")

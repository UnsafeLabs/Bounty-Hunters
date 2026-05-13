import struct

from python.tls_handshake import (
    TLSExtension,
    EXT_SNI,
)


class DummyHandshake:
    def __init__(self):
        self.extensions = {}
        self.server_name = None

    def parse_extensions(self, data: bytes):
        extensions = []
        offset = 0

        while offset + 4 <= len(data):
            ext_type = struct.unpack("!H", data[offset:offset + 2])[0]
            ext_len = struct.unpack("!H", data[offset + 2:offset + 4])[0]
            ext_data = data[offset + 4:offset + 4 + ext_len]
            offset += 4 + ext_len

            ext = TLSExtension(ext_type, ext_data)

            if ext_type == EXT_SNI:
                sni_offset = 2

                while sni_offset < len(ext_data):
                    name_type = ext_data[sni_offset]
                    sni_offset += 1

                    name_len = struct.unpack(
                        "!H",
                        ext_data[sni_offset:sni_offset + 2]
                    )[0]
                    sni_offset += 2

                    name_bytes = ext_data[
                        sni_offset:sni_offset + name_len
                    ]
                    sni_offset += name_len

                    if name_type == 0x00:
                        server_name = name_bytes.decode()

                        ext.server_name = server_name
                        self.server_name = server_name

            self.extensions[ext_type] = ext
            extensions.append(ext)

        return extensions


def test_sni_extension_parsing():
    hostname = b"example.com"

    sni_payload = (
        struct.pack("!H", len(hostname) + 3)
        + b"\x00"
        + struct.pack("!H", len(hostname))
        + hostname
    )

    extension = (
        struct.pack("!H", EXT_SNI)
        + struct.pack("!H", len(sni_payload))
        + sni_payload
    )

    handshake = DummyHandshake()
    extensions = handshake.parse_extensions(extension)

    assert handshake.server_name == "example.com"
    assert extensions[0].server_name == "example.com"


def test_no_sni_extension():
    handshake = DummyHandshake()

    handshake.parse_extensions(b"")

    assert handshake.server_name is None

import unittest
import struct
from tls_handshake import (
    TLSHandshake, HandshakeState, HandshakeType, ContentType,
    TLSExtension, HandshakeMessage, EXT_EXTENDED_MASTER_SECRET,
    EXT_SNI, EXT_SIGNATURE_ALGORITHMS, EXT_SUPPORTED_VERSIONS,
    EXT_KEY_SHARE,
)


class TestHandshakeState(unittest.TestCase):
    def test_transition_valid(self):
        tls = TLSHandshake()
        self.assertTrue(tls.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertEqual(tls.state, HandshakeState.CLIENT_HELLO)

    def test_transition_invalid(self):
        tls = TLSHandshake()
        tls.transition_to(HandshakeState.ERROR)
        self.assertFalse(tls.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertEqual(tls.state, HandshakeState.ERROR)


class TestParseRecord(unittest.TestCase):
    def setUp(self):
        self.tls = TLSHandshake()

    def _make_handshake_record(self, msg_type: int, payload: bytes) -> bytes:
        handshake_msg = struct.pack("!B", msg_type) + struct.pack("!I", len(payload))[1:4] + payload
        record = struct.pack("!BBBH", ContentType.HANDSHAKE.value, 3, 3, len(handshake_msg))
        return record + handshake_msg

    def test_parse_valid_handshake(self):
        data = self._make_handshake_record(HandshakeType.CLIENT_HELLO.value, b"\x00" * 32)
        msg = self.tls.parse_record(data)
        self.assertIsNotNone(msg)
        self.assertEqual(msg.msg_type, HandshakeType.CLIENT_HELLO)

    def test_parse_too_short(self):
        self.assertIsNone(self.tls.parse_record(b"\x00" * 3))

    def test_parse_wrong_content_type(self):
        data = bytearray(self._make_handshake_record(HandshakeType.CLIENT_HELLO.value, b"\x00" * 32))
        data[0] = 0xFF
        self.assertIsNone(self.tls.parse_record(bytes(data)))

    def test_parse_invalid_version(self):
        data = bytearray(self._make_handshake_record(HandshakeType.CLIENT_HELLO.value, b"\x00" * 32))
        data[1] = 0
        self.assertIsNone(self.tls.parse_record(bytes(data)))


class TestParseClientHello(unittest.TestCase):
    def setUp(self):
        self.tls = TLSHandshake()
        self.tls.state = HandshakeState.CLIENT_HELLO

    def _make_client_hello(self, extensions: bytes = b"") -> bytes:
        body = struct.pack("!H", 0x0303)  # version
        body += b"\x00" * 32               # random
        body += struct.pack("B", 0)         # session id length (0)
        body += struct.pack("!H", 2) + b"\x00\x01"  # cipher suites
        body += struct.pack("B", 1) + b"\x00"       # compression methods
        if extensions:
            body += struct.pack("!H", len(extensions)) + extensions
        handshake = struct.pack("!B", HandshakeType.CLIENT_HELLO.value)
        handshake += struct.pack("!I", len(body))[1:4] + body
        body += extensions
        record = struct.pack("!BBBH", ContentType.HANDSHAKE.value, 3, 3, len(handshake))
        return record + handshake

    def test_parse_client_hello_no_ext(self):
        data = self._make_client_hello()
        msg = self.tls.parse_record(data)
        self.assertTrue(self.tls.parse_client_hello(msg))

    def test_parse_client_hello_with_ext(self):
        ext_data = struct.pack("!HH", EXT_SNI, 4) + b"\x00\x00\x00\x00"
        data = self._make_client_hello(ext_data)
        msg = self.tls.parse_record(data)
        self.assertTrue(self.tls.parse_client_hello(msg))
        self.assertIn(EXT_SNI, self.tls.extensions)

    def test_parse_client_hello_too_short(self):
        msg = HandshakeMessage(HandshakeType.CLIENT_HELLO, b"\x00" * 10)
        self.assertFalse(self.tls.parse_client_hello(msg))


class TestParseExtensions(unittest.TestCase):
    def setUp(self):
        self.tls = TLSHandshake()

    def test_parse_ems_extension(self):
        data = struct.pack("!HH", EXT_EXTENDED_MASTER_SECRET, 0)
        exts = self.tls.parse_extensions(data)
        self.assertEqual(len(exts), 1)
        self.assertTrue(self.tls.negotiated_ems)

    def test_parse_multiple_extensions(self):
        data = struct.pack("!HH", EXT_SNI, 4) + b"\x00\x00\x00\x00"
        data += struct.pack("!HH", EXT_SIGNATURE_ALGORITHMS, 2) + b"\x00\x00"
        exts = self.tls.parse_extensions(data)
        self.assertEqual(len(exts), 2)

    def test_parse_empty(self):
        self.assertEqual(self.tls.parse_extensions(b""), [])


class TestVerifyFinished(unittest.TestCase):
    def test_verify_no_master_secret(self):
        tls = TLSHandshake()
        self.assertFalse(tls.verify_finished(b"\x00" * 12, "client finished"))

    def test_verify_correct(self):
        tls = TLSHandshake()
        tls.master_secret = b"\x01" * 48
        tls.client_random = b"\x02" * 32
        tls.server_random = b"\x03" * 32
        tls.handshake_hash.update(b"test transcript")
        verify = tls._prf(tls.master_secret, b"client finished",
                          tls.handshake_hash.copy().digest(), 12)
        self.assertTrue(tls.verify_finished(verify, "client finished"))


class TestProcessKeyExchange(unittest.TestCase):
    def test_key_exchange_short_payload(self):
        tls = TLSHandshake()
        msg = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")
        self.assertFalse(tls.process_key_exchange(msg))

    def test_key_exchange_valid(self):
        tls = TLSHandshake()
        tls.client_random = b"\x02" * 32
        tls.server_random = b"\x03" * 32
        encrypted = b"\x00" * 48
        payload = struct.pack("!H", len(encrypted)) + encrypted
        msg = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)
        self.assertTrue(tls.process_key_exchange(msg))


class TestProcessMessage(unittest.TestCase):
    def _make_record(self, msg_type: int, payload: bytes) -> bytes:
        handshake = struct.pack("!B", msg_type) + struct.pack("!I", len(payload))[1:4] + payload
        record = struct.pack("!BBBH", ContentType.HANDSHAKE.value, 3, 3, len(handshake))
        return record + handshake

    def test_full_handshake_sequence(self):
        tls = TLSHandshake(is_server=True)

        ch_payload = struct.pack("!H", 0x0303) + b"\x00" * 32
        ch_payload += struct.pack("B", 0)  # session id
        ch_payload += struct.pack("!H", 2) + b"\x00\x01"  # cipher suites
        ch_payload += struct.pack("B", 1) + b"\x00"  # compression
        ok, msg = tls.process_message(self._make_record(HandshakeType.CLIENT_HELLO.value, ch_payload))
        self.assertTrue(ok)

        sh_payload = struct.pack("!H", 0x0303) + b"\x01" * 32
        sh_payload += struct.pack("B", 0)  # session id
        sh_payload += struct.pack("!H", 0x1301)  # cipher suite
        sh_payload += struct.pack("B", 0)  # compression
        ok, msg = tls.process_message(self._make_record(HandshakeType.SERVER_HELLO.value, sh_payload))
        self.assertTrue(ok)

        ok, msg = tls.process_message(self._make_record(HandshakeType.CERTIFICATE.value, b"\x00" * 10))
        self.assertTrue(ok)


class TestPRF(unittest.TestCase):
    def setUp(self):
        self.tls = TLSHandshake()

    def test_prf_output_length(self):
        result = self.tls._prf(b"\x01" * 48, b"test label", b"\x02" * 32, 48)
        self.assertEqual(len(result), 48)

    def test_prf_deterministic(self):
        r1 = self.tls._prf(b"\x01" * 48, b"test label", b"\x02" * 32, 16)
        r2 = self.tls._prf(b"\x01" * 48, b"test label", b"\x02" * 32, 16)
        self.assertEqual(r1, r2)


if __name__ == "__main__":
    unittest.main()

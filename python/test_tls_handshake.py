import struct
import unittest

from tls_handshake import (
    EXT_SNI,
    HandshakeMessage,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
    VALID_TRANSITIONS,
)


def handshake_record(msg_type, payload):
    handshake = bytes([msg_type.value]) + len(payload).to_bytes(3, "big") + payload
    return b"\x16\x03\x03" + len(handshake).to_bytes(2, "big") + handshake


def client_hello_payload(extensions=b""):
    payload = bytearray()
    payload.extend(b"\x03\x03")
    payload.extend(b"\x01" * 32)
    payload.append(0)
    payload.extend(struct.pack("!H", 2))
    payload.extend(b"\x00\x2f")
    payload.append(1)
    payload.append(0)
    if extensions:
        payload.extend(struct.pack("!H", len(extensions)))
        payload.extend(extensions)
    return bytes(payload)


def sni_extension(hostname):
    name = hostname.encode("utf-8")
    server_name = b"\x00" + struct.pack("!H", len(name)) + name
    body = struct.pack("!H", len(server_name)) + server_name
    return struct.pack("!HH", EXT_SNI, len(body)) + body


class TLSHandshakeTests(unittest.TestCase):
    def test_client_hello_cannot_transition_directly_to_finished(self):
        tls = TLSHandshake()

        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )
        ok, _ = tls.process_message(
            handshake_record(
                HandshakeType.CLIENT_HELLO,
                client_hello_payload(),
            )
        )
        self.assertTrue(ok)
        self.assertFalse(tls.transition_to(HandshakeState.FINISHED))
        self.assertEqual(tls.state, HandshakeState.ERROR)

    def test_finished_after_client_hello_sets_error(self):
        tls = TLSHandshake()

        self.assertTrue(
            tls.process_message(
                handshake_record(
                    HandshakeType.CLIENT_HELLO,
                    client_hello_payload(),
                )
            )[0]
        )

        ok, message = tls.process_message(
            handshake_record(HandshakeType.FINISHED, b"\x00" * 12)
        )

        self.assertFalse(ok)
        self.assertEqual(message, "Invalid state for Finished")
        self.assertEqual(tls.state, HandshakeState.ERROR)
        self.assertIsNone(tls.master_secret)

    def test_parse_sni_extension_sets_server_name(self):
        tls = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_HELLO,
            client_hello_payload(sni_extension("example.com")),
        )

        self.assertTrue(tls.parse_client_hello(message))

        self.assertEqual(tls.server_name, "example.com")
        self.assertEqual(message.extensions[0].server_name, "example.com")

    def test_client_hello_without_sni_leaves_server_name_none(self):
        tls = TLSHandshake()
        message = HandshakeMessage(
            HandshakeType.CLIENT_HELLO,
            client_hello_payload(),
        )

        self.assertTrue(tls.parse_client_hello(message))

        self.assertIsNone(tls.server_name)

    def test_process_key_exchange_returns_false_for_expected_errors(self):
        tls = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30short")

        self.assertFalse(tls.process_key_exchange(message))

    def test_process_key_exchange_propagates_unexpected_errors(self):
        tls = TLSHandshake()
        tls.client_random = b"\x01" * 32
        tls.server_random = b"\x02" * 32
        message = HandshakeMessage(
            HandshakeType.CLIENT_KEY_EXCHANGE,
            b"\x00\x30" + b"x" * 48,
        )

        def raise_type_error(_):
            raise TypeError("unexpected")

        tls._decrypt_pre_master_secret = raise_type_error

        with self.assertRaises(TypeError):
            tls.process_key_exchange(message)


if __name__ == "__main__":
    unittest.main()

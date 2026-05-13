import struct
import unittest
from unittest import mock

from python.tls_handshake import (
    EXT_SNI,
    HandshakeMessage,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
)


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_client_hello_cannot_transition_directly_to_finished(self) -> None:
        handshake = TLSHandshake()

        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_sni_extension_decodes_host_name(self) -> None:
        hostname = b"example.com"
        server_name = b"\x00" + struct.pack("!H", len(hostname)) + hostname
        sni_data = struct.pack("!H", len(server_name)) + server_name

        handshake = TLSHandshake()
        extensions = handshake.parse_extensions(
            struct.pack("!HH", EXT_SNI, len(sni_data)) + sni_data
        )

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_absent_sni_leaves_server_name_unset(self) -> None:
        handshake = TLSHandshake()

        handshake.parse_extensions(b"")

        self.assertIsNone(handshake.server_name)

    def test_verify_finished_uses_constant_time_compare(self) -> None:
        handshake = TLSHandshake()
        handshake.master_secret = b"m" * 48

        with mock.patch(
            "python.tls_handshake.hmac.compare_digest",
            return_value=True,
        ) as compare_digest:
            self.assertTrue(handshake.verify_finished(b"verify-data", "client finished"))

        compare_digest.assert_called_once()

    def test_process_key_exchange_logs_expected_errors(self) -> None:
        handshake = TLSHandshake()
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00")

        with self.assertLogs(level="DEBUG") as logs:
            self.assertFalse(handshake.process_key_exchange(message))

        self.assertIn("Key exchange failed", logs.output[0])

    def test_process_key_exchange_propagates_unexpected_errors(self) -> None:
        handshake = TLSHandshake()
        payload = struct.pack("!H", 48) + (b"x" * 48)
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)

        with mock.patch.object(
            handshake,
            "_decrypt_pre_master_secret",
            side_effect=TypeError("unexpected"),
        ):
            with self.assertRaises(TypeError):
                handshake.process_key_exchange(message)

    def test_extended_master_secret_uses_distinct_label(self) -> None:
        pre_master_secret = b"p" * 48
        client_random = b"c" * 32
        server_random = b"s" * 32

        standard = TLSHandshake()
        standard._pre_master_secret = pre_master_secret
        standard.client_random = client_random
        standard.server_random = server_random
        standard.negotiated_ems = False
        standard._derive_master_secret()

        extended = TLSHandshake()
        extended._pre_master_secret = pre_master_secret
        extended.client_random = client_random
        extended.server_random = server_random
        extended.negotiated_ems = True
        extended._derive_master_secret()

        self.assertEqual(len(extended.master_secret), 48)
        self.assertNotEqual(standard.master_secret, extended.master_secret)


if __name__ == "__main__":
    unittest.main()

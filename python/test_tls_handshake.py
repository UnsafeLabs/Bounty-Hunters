import struct
import unittest

from tls_handshake import ContentType, HandshakeState, HandshakeType, TLSHandshake


def make_handshake_record(msg_type, payload):
    handshake_payload = (
        bytes([msg_type.value]) + len(payload).to_bytes(3, "big") + payload
    )
    return (
        bytes([ContentType.HANDSHAKE.value])
        + b"\x03\x03"
        + struct.pack("!H", len(handshake_payload))
        + handshake_payload
    )


class HandshakeStateMachineTests(unittest.TestCase):
    def test_client_hello_cannot_transition_directly_to_finished(self):
        handshake = TLSHandshake()
        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_finished_message_after_client_hello_is_rejected(self):
        handshake = TLSHandshake()
        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        finished_record = make_handshake_record(
            HandshakeType.FINISHED, b"\x00" * 12
        )

        success, status = handshake.process_message(finished_record)

        self.assertFalse(success)
        self.assertEqual(status, "Invalid state for Finished")
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

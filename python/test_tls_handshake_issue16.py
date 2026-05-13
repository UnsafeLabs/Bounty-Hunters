import unittest

from tls_handshake import HandshakeState, TLSHandshake, VALID_TRANSITIONS


class HandshakeTransitionTests(unittest.TestCase):
    def test_client_hello_can_only_transition_to_server_hello(self):
        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )

    def test_finished_from_client_hello_moves_to_error(self):
        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

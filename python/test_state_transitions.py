import unittest

from tls_handshake import HandshakeState, TLSHandshake, VALID_TRANSITIONS


class StateTransitionTests(unittest.TestCase):
    def test_client_hello_cannot_transition_directly_to_finished(self):
        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )

        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

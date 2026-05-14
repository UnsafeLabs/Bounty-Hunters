import unittest

from python.tls_handshake import HandshakeState, TLSHandshake, VALID_TRANSITIONS


class TLSHandshakeStateTransitionTests(unittest.TestCase):
    def test_client_hello_cannot_skip_directly_to_finished(self):
        self.assertNotIn(
            HandshakeState.FINISHED,
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
        )

        handshake = TLSHandshake()
        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_mandatory_intermediate_path_still_reaches_finished(self):
        handshake = TLSHandshake()

        for state in (
            HandshakeState.CLIENT_HELLO,
            HandshakeState.SERVER_HELLO,
            HandshakeState.CERTIFICATE,
            HandshakeState.KEY_EXCHANGE,
            HandshakeState.CHANGE_CIPHER_SPEC,
            HandshakeState.FINISHED,
        ):
            with self.subTest(state=state):
                self.assertTrue(handshake.transition_to(state))

        self.assertEqual(handshake.state, HandshakeState.FINISHED)


if __name__ == "__main__":
    unittest.main()

"""Regression tests for VALID_TRANSITIONS state machine (issue #16)."""

import unittest

from tls_handshake import HandshakeState, TLSHandshake, VALID_TRANSITIONS


class ValidTransitionsTests(unittest.TestCase):
    def test_client_hello_only_allows_server_hello(self):
        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )

    def test_transition_from_client_hello_to_finished_fails(self):
        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)

    def test_transition_from_client_hello_to_server_hello_succeeds(self):
        handshake = TLSHandshake()
        handshake.state = HandshakeState.CLIENT_HELLO

        self.assertTrue(handshake.transition_to(HandshakeState.SERVER_HELLO))
        self.assertEqual(handshake.state, HandshakeState.SERVER_HELLO)

    def test_full_handshake_path_still_reaches_finished(self):
        handshake = TLSHandshake()
        for next_state in [
            HandshakeState.CLIENT_HELLO,
            HandshakeState.SERVER_HELLO,
            HandshakeState.CERTIFICATE,
            HandshakeState.KEY_EXCHANGE,
            HandshakeState.CHANGE_CIPHER_SPEC,
            HandshakeState.FINISHED,
            HandshakeState.ESTABLISHED,
        ]:
            self.assertTrue(
                handshake.transition_to(next_state),
                f"transition to {next_state} should be valid",
            )


if __name__ == "__main__":
    unittest.main()

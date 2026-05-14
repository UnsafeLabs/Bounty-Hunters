import unittest

from tls_handshake import HandshakeState, TLSHandshake


class TLSHandshakeTransitionTests(unittest.TestCase):
    def test_client_hello_cannot_skip_to_finished(self):
        handshake = TLSHandshake()

        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(HandshakeState.ERROR, handshake.state)


if __name__ == "__main__":
    unittest.main()
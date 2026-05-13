import unittest

from tls_handshake import HandshakeState, TLSHandshake


class TLSHandshakeRegressionTests(unittest.TestCase):
    def test_finished_cannot_follow_client_hello_directly(self):
        handshake = TLSHandshake()

        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

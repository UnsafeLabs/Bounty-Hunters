import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import HandshakeState, TLSHandshake, VALID_TRANSITIONS


class TLSHandshakeStateTransitionTests(unittest.TestCase):
    def test_client_hello_only_allows_server_hello_next(self):
        self.assertEqual(
            VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO],
            [HandshakeState.SERVER_HELLO],
        )

    def test_client_hello_cannot_transition_directly_to_finished(self):
        handshake = TLSHandshake()
        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))

        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

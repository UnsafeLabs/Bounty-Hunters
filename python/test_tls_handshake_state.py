import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tls_handshake import HandshakeState, TLSHandshake


class TLSHandshakeStateTests(unittest.TestCase):
    def test_finished_cannot_skip_key_exchange(self):
        handshake = TLSHandshake()

        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.FINISHED))
        self.assertEqual(handshake.state, HandshakeState.ERROR)


if __name__ == "__main__":
    unittest.main()

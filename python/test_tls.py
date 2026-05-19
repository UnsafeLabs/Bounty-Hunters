import unittest
import hmac
import hashlib
from tls_handshake import TLSHandshake, HandshakeState, HandshakeType, HandshakeMessage

class TestTLSHandshake(unittest.TestCase):
    def setUp(self):
        self.tls = TLSHandshake(is_server=True)

    def test_state_transitions(self):
        # Initial state is IDLE
        self.assertEqual(self.tls.state, HandshakeState.IDLE)
        
        # Valid: IDLE -> CLIENT_HELLO
        self.assertTrue(self.tls.transition_to(HandshakeState.CLIENT_HELLO))
        
        # Invalid: CLIENT_HELLO -> FINISHED (Should fail because key exchange is missing)
        self.assertFalse(self.tls.transition_to(HandshakeState.FINISHED))
        self.assertEqual(self.tls.state, HandshakeState.ERROR)

    def test_ems_derivation_label(self):
        self.tls.state = HandshakeState.KEY_EXCHANGE
        self.tls._pre_master_secret = b"\x00" * 48
        self.tls.client_random = b"\x01" * 32
        self.tls.server_random = b"\x02" * 32
        
        # Test Standard Master Secret
        self.tls.negotiated_ems = False
        self.tls._derive_master_secret()
        ms_standard = self.tls.master_secret
        
        # Test Extended Master Secret
        self.tls.negotiated_ems = True
        self.tls._derive_master_secret()
        ms_ems = self.tls.master_secret
        
        self.assertNotEqual(ms_standard, ms_ems)

    def test_constant_time_comparison(self):
        # This is a unit test for logic, verify_finished uses hmac.compare_digest
        self.tls.master_secret = b"\x42" * 48
        # Mock handshake hash
        self.tls.handshake_hash = hashlib.sha256(b"transcript")
        
        # Correct verification data
        correct_verify = self.tls._prf(self.tls.master_secret, b"server finished", self.tls.handshake_hash.digest(), 12)
        
        self.assertTrue(self.tls.verify_finished(correct_verify, "server finished"))
        self.assertFalse(self.tls.verify_finished(b"wrong" * 3, "server finished"))

if __name__ == '__main__':
    unittest.main()

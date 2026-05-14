import unittest

from tls_handshake import TLSHandshake


class VerifyFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_result_semantics(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"secret"
        handshake._prf = lambda *args: b"expected"

        self.assertTrue(handshake.verify_finished(b"expected", "client finished"))
        self.assertFalse(handshake.verify_finished(b"different", "client finished"))


if __name__ == "__main__":
    unittest.main()
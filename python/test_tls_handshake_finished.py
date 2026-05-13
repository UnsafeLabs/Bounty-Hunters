import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tls_handshake import TLSHandshake


class TLSHandshakeFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_comparison(self):
        handshake = TLSHandshake()
        handshake.master_secret = b"\x01" * 48

        with patch("tls_handshake.hmac.compare_digest", return_value=True) as mocked:
            self.assertTrue(handshake.verify_finished(b"verify-data", "client finished"))

        mocked.assert_called_once()


if __name__ == "__main__":
    unittest.main()

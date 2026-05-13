import hmac
import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_tls_handshake():
    path = ROOT / "python" / "tls_handshake.py"
    spec = importlib.util.spec_from_file_location("tls_handshake", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifyFinishedTests(unittest.TestCase):
    def test_verify_finished_uses_constant_time_compare(self):
        tls = load_tls_handshake()
        handshake = tls.TLSHandshake()
        handshake.master_secret = b"m" * 48
        received = handshake._prf(
            handshake.master_secret,
            b"client finished",
            handshake.handshake_hash.copy().digest(),
            12,
        )

        with mock.patch.object(hmac, "compare_digest", wraps=hmac.compare_digest) as compare:
            self.assertTrue(handshake.verify_finished(received, "client finished"))
            compare.assert_called_once()


if __name__ == "__main__":
    unittest.main()

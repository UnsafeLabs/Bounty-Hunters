import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_tls_handshake():
    path = ROOT / "python" / "tls_handshake.py"
    spec = importlib.util.spec_from_file_location("tls_handshake", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExtendedMasterSecretTests(unittest.TestCase):
    def test_ems_uses_distinct_prf_label(self):
        tls = load_tls_handshake()

        standard = tls.TLSHandshake()
        standard._pre_master_secret = b"p" * 48
        standard.client_random = b"c" * 32
        standard.server_random = b"s" * 32
        standard.negotiated_ems = False
        standard._derive_master_secret()

        ems = tls.TLSHandshake()
        ems._pre_master_secret = b"p" * 48
        ems.client_random = b"c" * 32
        ems.server_random = b"s" * 32
        ems.negotiated_ems = True
        ems._derive_master_secret()

        self.assertEqual(len(standard.master_secret), 48)
        self.assertEqual(len(ems.master_secret), 48)
        self.assertNotEqual(standard.master_secret, ems.master_secret)


if __name__ == "__main__":
    unittest.main()

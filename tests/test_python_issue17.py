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


class SNIExtensionTests(unittest.TestCase):
    def test_sni_extension_sets_server_name(self):
        tls = load_tls_handshake()
        hostname = b"example.com"
        server_name = b"\x00" + len(hostname).to_bytes(2, "big") + hostname
        ext_data = len(server_name).to_bytes(2, "big") + server_name
        raw_ext = (
            tls.EXT_SNI.to_bytes(2, "big")
            + len(ext_data).to_bytes(2, "big")
            + ext_data
        )

        handshake = tls.TLSHandshake()
        extensions = handshake.parse_extensions(raw_ext)

        self.assertEqual(extensions[0].server_name, "example.com")
        self.assertEqual(handshake.server_name, "example.com")

    def test_missing_sni_leaves_server_name_unset(self):
        tls = load_tls_handshake()
        handshake = tls.TLSHandshake()
        handshake.parse_extensions(b"")
        self.assertIsNone(handshake.server_name)


if __name__ == "__main__":
    unittest.main()

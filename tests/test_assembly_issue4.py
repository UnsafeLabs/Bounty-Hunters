import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class TLS13ApplicationRecordTests(unittest.TestCase):
    def test_application_records_detect_tls13_inner_type(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        app_block = source.split(".handle_application:", 1)[1].split(".handle_heartbeat:", 1)[0]

        self.assertIn('msg_tls13_record    db "TLS 1.3 record detected", 10, 0', source)
        self.assertIn('msg_inner_type      db "Inner content type: 0x", 0', source)
        self.assertIn("cmp r14d, 0x0303", app_block)
        self.assertIn("je .handle_tls13_record", app_block)
        self.assertIn("movzx edi, byte [rdi+rcx-1]", app_block)


if __name__ == "__main__":
    unittest.main()

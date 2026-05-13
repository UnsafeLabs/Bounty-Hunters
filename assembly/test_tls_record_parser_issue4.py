from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class Tls13ApplicationRecordTests(unittest.TestCase):
    def test_application_records_with_legacy_tls13_version_branch_to_inner_type_parser(self):
        self.assertIn('msg_tls13       db "TLS 1.3 record detected", 10, 0', SOURCE)
        self.assertIn('msg_inner_type  db "Inner content type: 0x", 0', SOURCE)

        handler_start = SOURCE.index(".handle_application:")
        tls13_start = SOURCE.index(".handle_tls13_record:")
        heartbeat_start = SOURCE.index(".handle_heartbeat:")
        handler_body = SOURCE[handler_start:heartbeat_start]

        self.assertIn("cmp r14d, 0x0303", handler_body)
        self.assertIn("je .handle_tls13_record", handler_body)
        self.assertIn("test ecx, ecx", handler_body)
        self.assertIn("movzx edi, byte [rdi+rcx-1]", handler_body)
        self.assertLess(handler_start, tls13_start)


if __name__ == "__main__":
    unittest.main()

from pathlib import Path
import re
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class Tls13InnerTypeStaticTests(unittest.TestCase):
    def test_tls13_application_data_branches_to_inner_type_handler(self):
        self.assertRegex(
            SOURCE,
            r"\.handle_application:\s*\n\s*cmp r14d, 0x0303\s*\n"
            r"\s*je \.handle_tls13_record",
        )

    def test_tls13_handler_reports_marker_and_last_payload_byte(self):
        self.assertIn('lbl_tls13_record    db "TLS 1.3 record detected", 10, 0', SOURCE)
        self.assertIn('msg_inner_type      db "Inner content type: 0x", 0', SOURCE)
        self.assertTrue(
            re.search(
                r"\.handle_tls13_record:.*?test ecx, ecx.*?"
                r"movzx edi, byte \[rdi \+ rcx - 1\].*?call print_hex_byte",
                SOURCE,
                re.S,
            )
        )


if __name__ == "__main__":
    unittest.main()

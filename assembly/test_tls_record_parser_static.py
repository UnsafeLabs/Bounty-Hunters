from pathlib import Path
import re
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class TlsRecordParserStaticTests(unittest.TestCase):
    def test_content_type_upper_bound_rejects_values_above_max(self):
        self.assertRegex(
            SOURCE,
            r"cmp r13d, TLS_CT_MAX\s*\n\s*jle \.type_ok\s*;[^\n]*\n"
            r"(?:\s*;[^\n]*\n)*\s*jg \.invalid_type",
        )

    def test_alert_strings_are_independently_terminated(self):
        self.assertIn(
            'err_alert_fatal     db "FATAL ALERT received from peer", 10, 0',
            SOURCE,
        )
        self.assertIn(
            'err_alert_warning   db "WARNING: alert received from peer", 10, 0',
            SOURCE,
        )
        fatal_idx = SOURCE.index("err_alert_fatal")
        warning_idx = SOURCE.index("err_alert_warning")
        truncated_idx = SOURCE.index("err_truncated")
        self.assertLess(fatal_idx, warning_idx)
        self.assertLess(warning_idx, truncated_idx)

    def test_tls13_application_records_report_inner_content_type(self):
        self.assertIn('lbl_tls13_record    db "TLS 1.3 record detected", 10, 0', SOURCE)
        self.assertIn('msg_inner_type      db "Inner content type: 0x", 0', SOURCE)
        self.assertRegex(
            SOURCE,
            r"\.handle_application:\s*\n\s*cmp r14d, 0x0303\s*\n"
            r"\s*je \.handle_tls13_record",
        )
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

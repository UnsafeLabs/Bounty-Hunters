from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class TlsRecordParserBoundsTests(unittest.TestCase):
    def test_values_above_tls_content_type_max_are_rejected(self):
        self.assertRegex(
            SOURCE,
            r"cmp r13d, TLS_CT_MAX\s*\n\s*jle \.type_ok\s*;[^\n]*\n"
            r"(?:\s*;[^\n]*\n)*\s*jg \.invalid_type",
        )


if __name__ == "__main__":
    unittest.main()

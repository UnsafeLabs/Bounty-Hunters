from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class PayloadBoundsTests(unittest.TestCase):
    def test_payload_length_is_checked_against_bytes_read(self):
        self.assertIn("lea eax, [r15d+5]", SOURCE)
        self.assertIn("cmp eax, r12d", SOURCE)
        self.assertIn("ja .err_truncated", SOURCE)
        self.assertIn(".err_truncated:", SOURCE)

        check_pos = SOURCE.index("lea eax, [r15d+5]")
        payload_pos = SOURCE.index("lea rdi, [rsi+5]")
        self.assertLess(check_pos, payload_pos)


if __name__ == "__main__":
    unittest.main()

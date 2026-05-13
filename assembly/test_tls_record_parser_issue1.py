from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class VersionParsingTests(unittest.TestCase):
    def test_tls_version_is_decoded_as_big_endian(self):
        self.assertNotIn("mov ax, [rsi+1]", SOURCE)
        self.assertIn("movzx eax, byte [rsi+1]", SOURCE)
        self.assertIn("shl eax, 8", SOURCE)
        self.assertIn("movzx ebx, byte [rsi+2]", SOURCE)
        self.assertIn("mov r14d, eax", SOURCE)


if __name__ == "__main__":
    unittest.main()

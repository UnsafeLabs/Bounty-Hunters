import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class PayloadTruncationTests(unittest.TestCase):
    def test_payload_length_is_checked_against_available_bytes(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        block = source.split("; --- Read payload data ---", 1)[1].split("lea rdi, [rsi+5]", 1)[0]

        self.assertIn("mov eax, r15d", block)
        self.assertIn("add eax, 5", block)
        self.assertIn("cmp rax, r12", block)
        self.assertIn("ja .invalid_length", block)


if __name__ == "__main__":
    unittest.main()

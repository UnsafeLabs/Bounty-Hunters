import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class VersionByteOrderTests(unittest.TestCase):
    def test_version_bytes_are_loaded_big_endian(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        version_block = source.split("; --- Bytes 1-2: Protocol Version", 1)[1].split("; Print version", 1)[0]

        self.assertIn("movzx eax, byte [rsi+1]", version_block)
        self.assertIn("shl eax, 8", version_block)
        self.assertIn("movzx ebx, byte [rsi+2]", version_block)
        self.assertIn("or eax, ebx", version_block)
        self.assertIn("mov r14d, eax", version_block)
        self.assertNotIn("mov ax, [rsi+1]", version_block)


if __name__ == "__main__":
    unittest.main()

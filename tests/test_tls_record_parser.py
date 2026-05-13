import shutil
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASM = ROOT / "assembly" / "tls_record_parser.asm"
BIN = ROOT / "tests" / ".build" / "tls_record_parser"


def read_asm() -> str:
    return ASM.read_text()


def build_parser():
    if not sys.platform.startswith("linux"):
        return None

    nasm = shutil.which("nasm")
    ld = shutil.which("ld")
    if not nasm or not ld:
        return None

    build_dir = BIN.parent
    build_dir.mkdir(exist_ok=True)
    obj = build_dir / "tls_record_parser.o"
    subprocess.run([nasm, "-f", "elf64", str(ASM), "-o", str(obj)], check=True)
    subprocess.run([ld, str(obj), "-o", str(BIN)], check=True)
    return BIN


def run_parser(payload: bytes) -> str:
    parser = build_parser()
    if parser is None:
        return ""

    completed = subprocess.run(
        [str(parser)],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return completed.stdout.decode("utf-8", errors="replace")


class TlsRecordParserTests(unittest.TestCase):
    def test_payload_availability_is_checked_before_dispatch(self):
        source = read_asm()
        check_pos = source.index("cmp eax, r12d")
        payload_pos = source.index("lea rdi, [rsi+5]")
        dispatch_pos = source.index("; Dispatch based on content type")
        payload_block = source[source.rfind("; --- Read payload data ---", 0, payload_pos):payload_pos]

        self.assertLess(check_pos, payload_pos)
        self.assertLess(payload_pos, dispatch_pos)
        self.assertIn("mov eax, r15d", payload_block)
        self.assertIn("add eax, 5", payload_block)
        self.assertIn("ja .err_truncated", source[check_pos:payload_pos])

    def test_truncated_record_reports_error_when_runtime_tools_available(self):
        output = run_parser(bytes([0x16, 0x03, 0x03, 0x01, 0xF4]))
        if not output:
            self.skipTest("Linux with nasm and ld is required for runtime parser tests")

        self.assertIn("Payload length: 500", output)
        self.assertIn("Error: record payload truncated", output)
        self.assertNotIn("Handshake", output)

    def test_complete_record_still_dispatches_when_runtime_tools_available(self):
        output = run_parser(bytes([0x16, 0x03, 0x03, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00]))
        if not output:
            self.skipTest("Linux with nasm and ld is required for runtime parser tests")

        self.assertIn("Payload length: 4", output)
        self.assertIn("Handshake", output)
        self.assertNotIn("Error: record payload truncated", output)


if __name__ == "__main__":
    unittest.main()

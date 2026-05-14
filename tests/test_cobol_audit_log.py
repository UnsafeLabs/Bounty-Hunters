import re
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cobol" / "TLS-CERT-VALIDATOR.cbl"


class CobolAuditLogTests(unittest.TestCase):
    def test_audit_log_handles_long_subject_dn_without_silent_truncation(self):
        source = SOURCE.read_text()

        self.assertRegex(source, r"AUDIT-LOG-RECORD\s+PIC\s+X\(512\)")
        self.assertRegex(source, r"WS-SUBJECT-COMMON-NAME\s+PIC\s+X\(300\)")
        self.assertRegex(source, r"WS-VALIDATION-MSG\s+PIC\s+X\(300\)")
        self.assertIn("WS-AUDIT-PTR", source)
        self.assertIn("WS-AUDIT-RECORD-LENGTH", source)
        self.assertIn("ON OVERFLOW", source)
        self.assertIn("[TRUNCATED]", source)
        self.assertIn("TLSVAL-W080: AUDIT ENTRY TRUNCATED", source)

        audit_paragraph = source.split("8000-WRITE-AUDIT-ENTRY.", 1)[1]
        self.assertIn("WS-SUBJECT-COMMON-NAME", audit_paragraph)
        self.assertIn("WITH POINTER WS-AUDIT-PTR", audit_paragraph)

    def test_cobol_source_still_parses(self):
        cobc = shutil.which("cobc")
        if not cobc:
            self.skipTest("GnuCOBOL cobc is not installed")
        subprocess.run(
            [cobc, "-fsyntax-only", str(SOURCE)],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )


if __name__ == "__main__":
    unittest.main()

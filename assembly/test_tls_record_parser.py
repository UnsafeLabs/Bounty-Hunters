import re
from pathlib import Path
import unittest


ASM_SOURCE = Path(__file__).with_name("tls_record_parser.asm")


class AlertStringTerminationTests(unittest.TestCase):
    def setUp(self):
        self.source = ASM_SOURCE.read_text(encoding="utf-8")

    def _db_line_for(self, label):
        match = re.search(rf"^\s*{label}\s+db\s+(.+)$", self.source, re.MULTILINE)
        self.assertIsNotNone(match, f"{label} definition not found")
        return match.group(1)

    def test_warning_alert_string_is_newline_and_null_terminated(self):
        self.assertEqual(
            self._db_line_for("err_alert_warning"),
            '"WARNING: alert received from peer", 10, 0',
        )

    def test_fatal_alert_string_still_stops_before_warning_message(self):
        self.assertEqual(
            self._db_line_for("err_alert_fatal"),
            '"FATAL ALERT received from peer", 10, 0',
        )


if __name__ == "__main__":
    unittest.main()

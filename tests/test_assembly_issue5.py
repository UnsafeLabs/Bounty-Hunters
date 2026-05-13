import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class AlertWarningStringTests(unittest.TestCase):
    def test_warning_alert_string_is_newline_and_null_terminated(self):
        source = (ROOT / "assembly" / "tls_record_parser.asm").read_text()
        self.assertIn(
            'err_alert_warning   db "WARNING: alert received from peer", 10, 0',
            source,
        )
        self.assertNotIn(
            'err_alert_warning   db "WARNING: alert received from peer"\n',
            source,
        )


if __name__ == "__main__":
    unittest.main()

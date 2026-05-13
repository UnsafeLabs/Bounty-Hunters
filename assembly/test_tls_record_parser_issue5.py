from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class AlertWarningStringTests(unittest.TestCase):
    def test_warning_alert_string_is_null_terminated(self):
        self.assertIn(
            'err_alert_warning   db "WARNING: alert received from peer", 10, 0',
            SOURCE,
        )
        self.assertLess(SOURCE.index("err_alert_warning"), SOURCE.index("err_truncated"))


if __name__ == "__main__":
    unittest.main()

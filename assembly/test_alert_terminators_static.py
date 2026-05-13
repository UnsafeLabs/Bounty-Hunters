from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_record_parser.asm").read_text()


class AlertTerminatorStaticTests(unittest.TestCase):
    def test_alert_messages_are_independently_null_terminated(self):
        self.assertIn(
            'err_alert_fatal     db "FATAL ALERT received from peer", 10, 0',
            SOURCE,
        )
        self.assertIn(
            'err_alert_warning   db "WARNING: alert received from peer", 10, 0',
            SOURCE,
        )
        warning_idx = SOURCE.index("err_alert_warning")
        truncated_idx = SOURCE.index("err_truncated")
        self.assertLess(warning_idx, truncated_idx)


if __name__ == "__main__":
    unittest.main()

import re
from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class CheckExpiryOverflowTests(unittest.TestCase):
    def test_remaining_seconds_uses_wide_integer_math(self):
        body = re.search(
            r"static int check_expiry\([^)]*\)\s*\{(?P<body>.*?)\n\}",
            SOURCE,
            re.S,
        ).group("body")

        self.assertIn("int64_t remaining_seconds;", body)
        self.assertIn("remaining_seconds = (int64_t)day_diff * 86400 + sec_diff;", body)
        self.assertIn("(long long)remaining_seconds", body)


if __name__ == "__main__":
    unittest.main()

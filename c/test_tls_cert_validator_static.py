import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


class TLSCertValidatorStaticTests(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text(encoding="utf-8")

    def test_remaining_seconds_uses_64_bit_overflow_safe_math(self):
        self.assertIn("int64_t remaining_seconds;", self.source)
        self.assertIn(
            "remaining_seconds = (int64_t)day_diff * 86400 + sec_diff;",
            self.source,
        )
        self.assertIn("(long long)remaining_seconds", self.source)
        self.assertNotIn("int remaining_seconds;", self.source)
        self.assertNotIn("remaining_seconds = day_diff * 86400 + sec_diff;", self.source)


if __name__ == "__main__":
    unittest.main()

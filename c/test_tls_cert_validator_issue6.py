import re
from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class MatchFingerprintTests(unittest.TestCase):
    def test_fingerprint_comparison_uses_openssl_constant_time_api(self):
        body = re.search(
            r"static int match_fingerprint\([^)]*\)\s*\{(?P<body>.*?)\n\}",
            SOURCE,
            re.S,
        ).group("body")

        self.assertIn("CRYPTO_memcmp(fp1, fp2, FINGERPRINT_LEN) == 0", body)
        self.assertIsNone(re.search(r"(?<!CRYPTO_)memcmp\s*\(", body))


if __name__ == "__main__":
    unittest.main()

import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


class TLSCertValidatorStaticTests(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text(encoding="utf-8")

    def test_fingerprint_match_uses_openssl_constant_time_compare(self):
        self.assertIn(
            "return CRYPTO_memcmp(fp1, fp2, FINGERPRINT_LEN) == 0;",
            self.source,
        )
        self.assertNotIn("return memcmp(fp1, fp2, FINGERPRINT_LEN) == 0;", self.source)


if __name__ == "__main__":
    unittest.main()

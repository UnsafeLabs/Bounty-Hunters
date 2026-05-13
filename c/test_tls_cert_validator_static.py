import re
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

    def test_cleanup_logs_issuer_before_freeing_it(self):
        cleanup = re.search(
            r"static void cleanup_cert_store\(cert_store_t \*store\)(.*?)"
            r"int add_trusted_cert",
            self.source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(cleanup)
        body = cleanup.group(1)

        log_index = body.index('log_cert_event(LOG_LEVEL_DEBUG, "freed cert store entry: %s"')
        issuer_free_index = body.index("free(entry->issuer);")

        self.assertLess(log_index, issuer_free_index)

    def test_remaining_seconds_uses_64_bit_overflow_safe_math(self):
        self.assertIn("int64_t remaining_seconds;", self.source)
        self.assertIn(
            "remaining_seconds = (int64_t)day_diff * 86400 + sec_diff;",
            self.source,
        )
        self.assertIn("(long long)remaining_seconds", self.source)

    def test_validate_chain_routes_failures_through_single_cleanup(self):
        validate_chain = re.search(
            r"static int validate_chain\(chain_context_t \*ctx\)(.*?)"
            r"static void cleanup_cert_store",
            self.source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(validate_chain)
        body = validate_chain.group(1)
        cleanup_index = body.index("cleanup:")

        self.assertEqual(body.count("cleanup:"), 1)
        self.assertEqual(body.count("return "), 1)
        self.assertGreater(body.index("return rc;"), cleanup_index)
        self.assertIn("goto cleanup;", body[:cleanup_index])
        self.assertNotIn("return CERT_STATUS_", body[:cleanup_index])


if __name__ == "__main__":
    unittest.main()

import re
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


class TLSCertValidatorStaticTests(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text(encoding="utf-8")

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


if __name__ == "__main__":
    unittest.main()

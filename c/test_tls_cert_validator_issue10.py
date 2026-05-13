import re
from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class CleanupCertStoreTests(unittest.TestCase):
    def test_debug_log_uses_issuer_before_free(self):
        body = re.search(
            r"static void cleanup_cert_store\([^)]*\)\s*\{(?P<body>.*?)\n\}",
            SOURCE,
            re.S,
        ).group("body")

        log_pos = body.index('log_cert_event(LOG_LEVEL_DEBUG, "freed cert store entry: %s", entry->issuer);')
        subject_free_pos = body.index("free(entry->subject);")
        issuer_free_pos = body.index("free(entry->issuer);")

        self.assertLess(log_pos, subject_free_pos)
        self.assertLess(log_pos, issuer_free_pos)


if __name__ == "__main__":
    unittest.main()

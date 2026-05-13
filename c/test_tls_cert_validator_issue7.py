from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class ValidateChainCleanupTests(unittest.TestCase):
    def test_validate_chain_errors_route_through_cleanup_label(self):
        start = SOURCE.index("static int validate_chain")
        end = SOURCE.index("static void cleanup_cert_store")
        body = SOURCE[start:end]

        self.assertIn("cleanup:", body)
        self.assertEqual(body.count("return rc;"), 1)
        self.assertNotIn("return CERT_STATUS_INVALID;", body)
        self.assertNotIn("return CERT_STATUS_UNTRUSTED;", body)
        self.assertGreaterEqual(body.count("goto cleanup;"), 6)
        self.assertIn('log_cert_event(LOG_LEVEL_ERROR, "cert at depth %d failed expiry check", i);', body)


if __name__ == "__main__":
    unittest.main()

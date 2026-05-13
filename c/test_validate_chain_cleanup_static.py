from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()
VALIDATE_CHAIN = SOURCE[SOURCE.index("static int validate_chain") :]
VALIDATE_CHAIN = VALIDATE_CHAIN[: VALIDATE_CHAIN.index("static void cleanup_cert_store")]


class ValidateChainCleanupStaticTests(unittest.TestCase):
    def test_validate_chain_error_paths_use_single_cleanup_exit(self):
        self.assertIn("cleanup:\n    return status;", VALIDATE_CHAIN)
        self.assertNotIn("return rc;", VALIDATE_CHAIN)
        self.assertNotIn("return CERT_STATUS_UNTRUSTED;", VALIDATE_CHAIN)
        self.assertNotIn("return CERT_STATUS_INVALID;", VALIDATE_CHAIN)
        self.assertGreaterEqual(VALIDATE_CHAIN.count("goto cleanup;"), 8)

    def test_existing_status_codes_are_preserved_before_cleanup(self):
        self.assertIn("status = rc;", VALIDATE_CHAIN)
        self.assertIn("status = CERT_STATUS_UNTRUSTED;", VALIDATE_CHAIN)
        self.assertIn("status = CERT_STATUS_INVALID;", VALIDATE_CHAIN)
        self.assertIn("status = CERT_STATUS_OK;", VALIDATE_CHAIN)


if __name__ == "__main__":
    unittest.main()

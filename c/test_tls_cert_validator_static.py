import re
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


class TLSCertValidatorStaticTests(unittest.TestCase):
    def setUp(self):
        self.source = SOURCE.read_text(encoding="utf-8")

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

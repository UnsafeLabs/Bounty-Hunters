from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class OcspStaplingTests(unittest.TestCase):
    def test_ocsp_response_is_checked_and_freed(self):
        self.assertIn("const unsigned char *ocsp_response_der;", SOURCE)
        self.assertIn("size_t          ocsp_response_len;", SOURCE)

        start = SOURCE.index("static int check_ocsp_stapling")
        end = SOURCE.index("static cert_entry_t *find_issuer")
        ocsp_body = SOURCE[start:end]

        self.assertIn("d2i_OCSP_RESPONSE", ocsp_body)
        self.assertIn("OCSP_response_status(resp) != OCSP_RESPONSE_STATUS_SUCCESSFUL", ocsp_body)
        self.assertIn("OCSP_response_get1_basic", ocsp_body)
        self.assertIn("OCSP_resp_find_status", ocsp_body)
        self.assertIn("cert_status == V_OCSP_CERTSTATUS_REVOKED", ocsp_body)
        self.assertIn("cert_status == V_OCSP_CERTSTATUS_GOOD", ocsp_body)
        self.assertIn("OCSP_CERTID_free(cert_id);", ocsp_body)
        self.assertIn("OCSP_BASICRESP_free(basic);", ocsp_body)
        self.assertIn("OCSP_RESPONSE_free(resp);", ocsp_body)

    def test_validate_chain_calls_ocsp_before_fingerprint_pinning(self):
        start = SOURCE.index("static int validate_chain")
        end = SOURCE.index("static void cleanup_cert_store")
        validate_body = SOURCE[start:end]

        ocsp_pos = validate_body.index("check_ocsp_stapling")
        fingerprint_pos = validate_body.index("/* Fingerprint pinning on leaf */")

        self.assertIn("if (ctx->verify_ocsp)", validate_body)
        self.assertLess(ocsp_pos, fingerprint_pos)


if __name__ == "__main__":
    unittest.main()

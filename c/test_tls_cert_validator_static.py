from pathlib import Path
import re
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()


class TlsCertValidatorStaticTests(unittest.TestCase):
    def test_validate_chain_uses_single_cleanup_exit_for_error_paths(self):
        self.assertIn("cleanup:\n    return status;", SOURCE)
        validate_chain = SOURCE[SOURCE.index("static int validate_chain") :]
        validate_chain = validate_chain[: validate_chain.index("static void cleanup_cert_store")]
        self.assertNotIn("return rc;", validate_chain)
        self.assertNotIn("return CERT_STATUS_UNTRUSTED;", validate_chain)
        self.assertNotIn("return CERT_STATUS_INVALID;", validate_chain)
        self.assertGreaterEqual(validate_chain.count("goto cleanup;"), 8)

    def test_ocsp_context_and_validation_are_wired_before_fingerprint_pinning(self):
        self.assertIn("const unsigned char *ocsp_response_der;", SOURCE)
        self.assertIn("size_t          ocsp_response_len;", SOURCE)
        validate_chain = SOURCE[SOURCE.index("static int validate_chain") :]
        validate_chain = validate_chain[: validate_chain.index("static void cleanup_cert_store")]
        ocsp_idx = validate_chain.index("check_ocsp_stapling(ctx->chain[0], leaf_issuer")
        pin_idx = validate_chain.index("/* Fingerprint pinning on leaf */")
        self.assertLess(ocsp_idx, pin_idx)
        self.assertRegex(
            validate_chain,
            r"leaf_issuer = \(ctx->chain_len > 1\) \? ctx->chain\[1\] : trusted_issuer->cert;",
        )

    def test_ocsp_stapling_handles_good_revoked_and_frees_openssl_objects(self):
        self.assertIn("static int check_ocsp_stapling(", SOURCE)
        self.assertIn("d2i_OCSP_RESPONSE(NULL, &p, (long)resp_len)", SOURCE)
        self.assertIn("OCSP_response_status(resp) != OCSP_RESPONSE_STATUS_SUCCESSFUL", SOURCE)
        self.assertIn("OCSP_response_get1_basic(resp)", SOURCE)
        self.assertIn("OCSP_cert_to_id(NULL, leaf, issuer)", SOURCE)
        self.assertIn("OCSP_resp_find_status(basic, cert_id, &cert_status", SOURCE)
        self.assertIn("cert_status == V_OCSP_CERTSTATUS_GOOD", SOURCE)
        self.assertIn("cert_status == V_OCSP_CERTSTATUS_REVOKED", SOURCE)
        self.assertIn("rc = CERT_STATUS_REVOKED;", SOURCE)
        self.assertIn("OCSP_CERTID_free(cert_id);", SOURCE)
        self.assertIn("OCSP_BASICRESP_free(basic);", SOURCE)
        self.assertIn("OCSP_RESPONSE_free(resp);", SOURCE)


if __name__ == "__main__":
    unittest.main()

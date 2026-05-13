from pathlib import Path
import unittest


SOURCE = Path(__file__).with_name("tls_cert_validator.c").read_text()
VALIDATE_CHAIN = SOURCE[SOURCE.index("static int validate_chain") :]
VALIDATE_CHAIN = VALIDATE_CHAIN[: VALIDATE_CHAIN.index("static void cleanup_cert_store")]


class OcspStaplingStaticTests(unittest.TestCase):
    def test_context_carries_stapled_ocsp_response(self):
        self.assertIn("const unsigned char *ocsp_response_der;", SOURCE)
        self.assertIn("size_t          ocsp_response_len;", SOURCE)

    def test_ocsp_check_is_called_before_fingerprint_pinning(self):
        ocsp_idx = VALIDATE_CHAIN.index("check_ocsp_stapling(ctx->chain[0], leaf_issuer")
        pin_idx = VALIDATE_CHAIN.index("/* Fingerprint pinning on leaf */")
        self.assertLess(ocsp_idx, pin_idx)
        self.assertIn(
            "leaf_issuer = (ctx->chain_len > 1) ? ctx->chain[1] : trusted_issuer->cert;",
            VALIDATE_CHAIN,
        )

    def test_ocsp_response_statuses_and_allocations_are_handled(self):
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

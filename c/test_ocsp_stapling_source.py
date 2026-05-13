from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


def test_ocsp_stapling_parses_status_and_frees_openssl_structures():
    source = SOURCE.read_text()

    assert "const unsigned char *ocsp_response_der;" in source
    assert "size_t          ocsp_response_len;" in source
    assert "static int check_ocsp_stapling(" in source
    assert "d2i_OCSP_RESPONSE(NULL, &p, (long)resp_len)" in source
    assert "OCSP_RESPONSE_STATUS_SUCCESSFUL" in source
    assert "OCSP_response_get1_basic(resp)" in source
    assert "OCSP_cert_to_id(NULL, leaf, issuer)" in source
    assert "OCSP_resp_find_status(basic, cert_id" in source
    assert "status == V_OCSP_CERTSTATUS_REVOKED" in source
    assert "status == V_OCSP_CERTSTATUS_GOOD" in source
    assert "OCSP_CERTID_free(cert_id)" in source
    assert "OCSP_BASICRESP_free(basic)" in source
    assert "OCSP_RESPONSE_free(resp)" in source


def test_validate_chain_calls_ocsp_before_fingerprint_pinning():
    source = SOURCE.read_text()
    validate_start = source.index("static int validate_chain")
    validate_end = source.index("static void cleanup_cert_store", validate_start)
    body = source[validate_start:validate_end]

    ocsp_pos = body.index("check_ocsp_stapling(ctx->chain[0]")
    pinning_pos = body.index("/* Fingerprint pinning on leaf */")

    assert "if (ctx->verify_ocsp)" in body
    assert "ctx->ocsp_response_der" in body
    assert "ctx->ocsp_response_len" in body
    assert ocsp_pos < pinning_pos


if __name__ == "__main__":
    test_ocsp_stapling_parses_status_and_frees_openssl_structures()
    test_validate_chain_calls_ocsp_before_fingerprint_pinning()

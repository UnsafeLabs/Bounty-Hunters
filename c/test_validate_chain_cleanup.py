from pathlib import Path


SOURCE = Path(__file__).with_name("tls_cert_validator.c")


def validate_chain_body():
    source = SOURCE.read_text()
    start = source.index("static int validate_chain")
    end = source.index("static void cleanup_cert_store", start)
    return source[start:end]


def test_validate_chain_routes_errors_through_cleanup_label():
    body = validate_chain_body()

    assert "cleanup:" in body
    assert body.count("goto cleanup;") >= 7
    assert "cert at depth %d failed expiry check" in body
    assert "signature invalid at depth %d" in body
    assert "root not found in trusted store" in body
    assert "leaf fingerprint mismatch" in body

    before_cleanup = body.split("cleanup:", 1)[0]
    assert "return rc;" not in before_cleanup
    assert "return CERT_STATUS_" not in before_cleanup


if __name__ == "__main__":
    test_validate_chain_routes_errors_through_cleanup_label()

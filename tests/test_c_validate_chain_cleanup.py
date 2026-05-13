from pathlib import Path
import re

SOURCE = Path(__file__).resolve().parents[1] / "c" / "tls_cert_validator.c"


def _validate_chain_body():
    text = SOURCE.read_text()
    match = re.search(r"static int validate_chain\(chain_context_t \*ctx\)\n\{(?P<body>.*?)\n\}", text, re.S)
    assert match, "validate_chain() not found"
    return match.group("body")


def test_validate_chain_error_paths_use_single_cleanup_label():
    body = _validate_chain_body()
    assert "cleanup:" in body

    before_cleanup, after_cleanup = body.split("cleanup:", 1)
    assert "goto cleanup;" in before_cleanup
    assert "return " not in before_cleanup
    assert after_cleanup.count("return rc;") == 1

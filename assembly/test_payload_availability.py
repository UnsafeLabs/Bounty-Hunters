from pathlib import Path


SOURCE = Path(__file__).with_name("tls_record_parser.asm")


def test_declared_payload_length_is_checked_against_bytes_read():
    source = SOURCE.read_text()
    start = source.index("; Validate length doesn't exceed TLS maximum")
    end = source.index("; --- Read payload data ---", start)
    block = source[start:end]

    assert "cmp r15d, TLS_MAX_RECORD_LEN" in block
    assert "ja .invalid_length" in block
    assert "lea eax, [r15 + 5]" in block
    assert "cmp eax, r12d" in block


if __name__ == "__main__":
    test_declared_payload_length_is_checked_against_bytes_read()

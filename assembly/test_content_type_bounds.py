from pathlib import Path


SOURCE = Path(__file__).with_name("tls_record_parser.asm")


def test_content_type_upper_bound_branches_to_invalid_type():
    source = SOURCE.read_text()
    start = source.index("; Validate content type range")
    end = source.index(".type_ok:", start)
    block = source[start:end]

    assert "cmp r13d, TLS_CT_MIN" in block
    assert "jl .invalid_type" in block
    assert "cmp r13d, TLS_CT_MAX" in block
    assert "jle .type_ok" in block
    assert "jg .invalid_type" in block


if __name__ == "__main__":
    test_content_type_upper_bound_branches_to_invalid_type()

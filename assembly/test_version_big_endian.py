from pathlib import Path


SOURCE = Path(__file__).with_name("tls_record_parser.asm")


def test_tls_version_is_loaded_big_endian():
    source = SOURCE.read_text()
    marker = "; --- Bytes 1-2: Protocol Version (big-endian) ---"
    start = source.index(marker)
    end = source.index("; Print version", start)
    block = source[start:end]

    assert "mov ax, [rsi+1]" not in block
    assert "movzx eax, byte [rsi+1]" in block
    assert "shl eax, 8" in block
    assert "movzx ebx, byte [rsi+2]" in block
    assert "or eax, ebx" in block
    assert "mov r14d, eax" in block


if __name__ == "__main__":
    test_tls_version_is_loaded_big_endian()

from pathlib import Path


SOURCE = Path(__file__).with_name("tls_record_parser.asm")


def test_application_handler_detects_tls13_inner_type():
    source = SOURCE.read_text()

    assert 'msg_tls13       db "TLS 1.3 record detected", 10, 0' in source
    assert 'msg_inner_type  db "Inner content type: 0x", 0' in source

    start = source.index(".handle_application:")
    end = source.index(".handle_heartbeat:", start)
    block = source[start:end]

    assert "cmp r14d, 0x0303" in block
    assert "je .handle_tls13_record" in block
    assert ".handle_tls13_record:" in block
    assert "cmp ecx, 0" in block
    assert "jle .parse_done" in block
    assert "movzx edi, byte [rdi + rcx - 1]" in block
    assert "call print_hex_byte" in block


if __name__ == "__main__":
    test_application_handler_detects_tls13_inner_type()

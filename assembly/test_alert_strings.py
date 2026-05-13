from pathlib import Path


SOURCE = Path(__file__).with_name("tls_record_parser.asm")


def test_alert_strings_are_terminated_before_next_error():
    source = SOURCE.read_text()

    assert 'err_alert_fatal     db "FATAL ALERT received from peer", 10' in source
    assert 'err_alert_warning   db "WARNING: alert received from peer", 10, 0' in source

    warning_pos = source.index("err_alert_warning")
    truncated_pos = source.index("err_truncated")
    warning_line = source[warning_pos:truncated_pos].splitlines()[0]

    assert warning_line.endswith(', 10, 0')


if __name__ == "__main__":
    test_alert_strings_are_terminated_before_next_error()

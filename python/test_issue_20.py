from tls_handshake import TLSHandshake, HandshakeMessage, HandshakeType
import struct


def test_expected_value_error_returns_false():
    hs = TLSHandshake()
    msg = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30short")
    assert hs.process_key_exchange(msg) is False


def test_unexpected_type_error_propagates():
    hs = TLSHandshake()
    msg = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00\x30" + b"x" * 48)

    def boom(_):
        raise TypeError("unexpected bug")

    hs._decrypt_pre_master_secret = boom
    try:
        hs.process_key_exchange(msg)
    except TypeError as exc:
        assert "unexpected bug" in str(exc)
    else:
        raise AssertionError("TypeError should propagate")


if __name__ == "__main__":
    test_expected_value_error_returns_false()
    test_unexpected_type_error_propagates()
    print("issue #20 tests passed")

from tls_handshake import TLSHandshake, HandshakeState, VALID_TRANSITIONS


def test_client_hello_only_allows_server_hello():
    assert VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO] == [HandshakeState.SERVER_HELLO]


def test_client_hello_to_finished_is_rejected_and_enters_error():
    hs = TLSHandshake()
    hs.state = HandshakeState.CLIENT_HELLO

    result = hs.transition_to(HandshakeState.FINISHED)

    assert result is False
    assert hs.state == HandshakeState.ERROR


if __name__ == "__main__":
    test_client_hello_only_allows_server_hello()
    test_client_hello_to_finished_is_rejected_and_enters_error()
    print("issue #16 tests passed")

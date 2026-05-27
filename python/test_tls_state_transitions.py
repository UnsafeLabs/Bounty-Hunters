from tls_handshake import (
    HandshakeMessage,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
    VALID_TRANSITIONS,
)


def test_client_hello_allows_only_server_hello() -> None:
    assert VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO] == [
        HandshakeState.SERVER_HELLO
    ]


def test_client_hello_to_finished_is_rejected_and_sets_error() -> None:
    hs = TLSHandshake()
    hs.state = HandshakeState.CLIENT_HELLO

    transitioned = hs.transition_to(HandshakeState.FINISHED)

    assert transitioned is False
    assert hs.state is HandshakeState.ERROR


def test_process_message_finished_after_client_hello_cannot_bypass() -> None:
    hs = TLSHandshake()
    hs.state = HandshakeState.CLIENT_HELLO
    hs.parse_record = lambda _: HandshakeMessage(HandshakeType.FINISHED, b"")

    ok, message = hs.process_message(b"ignored")

    assert ok is False
    assert message == "Invalid state for Finished"
    assert hs.state is HandshakeState.ERROR
    assert hs.state is not HandshakeState.ESTABLISHED
    assert hs.master_secret is None

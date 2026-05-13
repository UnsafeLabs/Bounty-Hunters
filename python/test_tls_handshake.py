"""Tests for tls_handshake._derive_master_secret() EMS label handling (RFC 7627)."""

from tls_handshake import TLSHandshake


def _setup_handshake(ems: bool) -> TLSHandshake:
    handshake = TLSHandshake(is_server=False)
    handshake._pre_master_secret = b"\xaa" * 48
    handshake.client_random = b"\xcc" * 32
    handshake.server_random = b"\xdd" * 32
    handshake.negotiated_ems = ems
    return handshake


def test_ems_branch_uses_extended_master_secret_label() -> None:
    handshake = _setup_handshake(ems=True)
    handshake._derive_master_secret()
    assert isinstance(handshake.master_secret, bytes)
    assert len(handshake.master_secret) == 48


def test_non_ems_branch_uses_master_secret_label() -> None:
    handshake = _setup_handshake(ems=False)
    handshake._derive_master_secret()
    assert isinstance(handshake.master_secret, bytes)
    assert len(handshake.master_secret) == 48


def test_ems_and_non_ems_produce_different_master_secrets() -> None:
    """The whole point of EMS: a different label must yield a different secret."""
    ems = _setup_handshake(ems=True)
    non_ems = _setup_handshake(ems=False)

    ems._derive_master_secret()
    non_ems._derive_master_secret()

    assert ems.master_secret != non_ems.master_secret


def test_derive_raises_without_pre_master_secret() -> None:
    handshake = TLSHandshake()
    try:
        handshake._derive_master_secret()
    except ValueError as exc:
        assert "pre-master secret" in str(exc)
    else:
        raise AssertionError("expected ValueError when pre-master secret is missing")

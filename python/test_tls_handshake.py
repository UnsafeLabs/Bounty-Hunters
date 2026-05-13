"""Tests for tls_handshake.verify_finished() constant-time comparison."""

import hashlib
import hmac

from tls_handshake import TLSHandshake


def _expected_verify(handshake: TLSHandshake, label: str) -> bytes:
    transcript_hash = handshake.handshake_hash.copy().digest()
    return handshake._prf(
        handshake.master_secret,
        label.encode("ascii"),
        transcript_hash,
        12,
    )


def test_verify_finished_returns_true_on_match() -> None:
    handshake = TLSHandshake(is_server=False)
    handshake.master_secret = b"\x11" * 48
    expected = _expected_verify(handshake, "client finished")

    assert handshake.verify_finished(expected, "client finished") is True


def test_verify_finished_returns_false_on_mismatch() -> None:
    handshake = TLSHandshake(is_server=False)
    handshake.master_secret = b"\x22" * 48
    expected = _expected_verify(handshake, "client finished")
    tampered = bytes([expected[0] ^ 0x01]) + expected[1:]

    assert handshake.verify_finished(tampered, "client finished") is False


def test_verify_finished_uses_constant_time_comparison() -> None:
    """The fix replaces == with hmac.compare_digest(); verify the source reflects that."""
    import inspect

    source = inspect.getsource(TLSHandshake.verify_finished)
    assert "hmac.compare_digest" in source
    assert "computed_verify == received_verify" not in source


def test_verify_finished_returns_false_when_master_secret_missing() -> None:
    handshake = TLSHandshake(is_server=True)
    assert handshake.master_secret is None
    assert handshake.verify_finished(b"\x00" * 12, "server finished") is False

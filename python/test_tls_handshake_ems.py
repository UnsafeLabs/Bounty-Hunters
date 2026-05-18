import hashlib

from tls_handshake import TLSHandshake


def _prepared_handshake(ems_enabled):
    handshake = TLSHandshake()
    handshake.client_random = b"c" * 32
    handshake.server_random = b"s" * 32
    handshake._pre_master_secret = b"p" * 48
    handshake.negotiated_ems = ems_enabled
    handshake.handshake_hash.update(b"client/server handshake transcript")
    return handshake


def test_ems_master_secret_uses_rfc7627_label_and_session_hash():
    handshake = _prepared_handshake(True)
    calls = []

    def capture_prf(secret, label, seed, output_len):
        calls.append((secret, label, seed, output_len))
        return b"m" * output_len

    handshake._prf = capture_prf
    handshake._derive_master_secret()

    assert handshake.master_secret == b"m" * 48
    assert calls == [
        (
            b"p" * 48,
            b"extended master secret",
            hashlib.sha256(b"client/server handshake transcript").digest(),
            48,
        )
    ]


def test_non_ems_master_secret_keeps_legacy_label_and_random_seed():
    handshake = _prepared_handshake(False)
    calls = []

    def capture_prf(secret, label, seed, output_len):
        calls.append((secret, label, seed, output_len))
        return b"m" * output_len

    handshake._prf = capture_prf
    handshake._derive_master_secret()

    assert calls == [
        (
            b"p" * 48,
            b"master secret",
            b"c" * 32 + b"s" * 32,
            48,
        )
    ]

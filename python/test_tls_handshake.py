from tls_handshake import TLSHandshake


def _build_handshake() -> TLSHandshake:
    hs = TLSHandshake()
    hs._pre_master_secret = b"\x01" * 48
    hs.client_random = b"\x02" * 32
    hs.server_random = b"\x03" * 32
    hs.handshake_hash.update(b"client_hello||server_hello||certificate")
    return hs


def test_ems_uses_rfc7627_label_and_seed() -> None:
    hs = _build_handshake()
    hs.negotiated_ems = True
    hs._derive_master_secret()
    ems_master = hs.master_secret

    regular_hs = _build_handshake()
    regular_hs.negotiated_ems = False
    regular_hs._derive_master_secret()
    regular_master = regular_hs.master_secret

    assert ems_master != regular_master
    expected_ems = _build_handshake()._prf(
        b"\x01" * 48,
        b"extended master secret",
        _build_handshake().handshake_hash.copy().digest(),
        48,
    )
    assert ems_master == expected_ems

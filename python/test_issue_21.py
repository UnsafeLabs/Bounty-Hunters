from tls_handshake import TLSHandshake


def derive(ems: bool) -> bytes:
    hs = TLSHandshake()
    hs._pre_master_secret = b"p" * 48
    hs.client_random = b"c" * 32
    hs.server_random = b"s" * 32
    hs.negotiated_ems = ems
    hs._derive_master_secret()
    return hs.master_secret


def test_ems_and_non_ems_use_different_prf_labels():
    ems_secret = derive(True)
    normal_secret = derive(False)
    assert len(ems_secret) == 48
    assert len(normal_secret) == 48
    assert ems_secret != normal_secret


def test_ems_label_matches_extended_master_secret():
    hs = TLSHandshake()
    hs._pre_master_secret = b"p" * 48
    hs.client_random = b"c" * 32
    hs.server_random = b"s" * 32
    hs.negotiated_ems = True
    expected = hs._prf(hs._pre_master_secret, b"extended master secret", hs.client_random + hs.server_random, 48)
    hs._derive_master_secret()
    assert hs.master_secret == expected


if __name__ == "__main__":
    test_ems_and_non_ems_use_different_prf_labels()
    test_ems_label_matches_extended_master_secret()
    print("issue #21 tests passed")

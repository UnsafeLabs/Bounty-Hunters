from tls_handshake import TLSHandshake
import hmac


def test_verify_finished_uses_compare_digest(monkey_patch=None):
    calls = []
    original = hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return original(a, b)

    hmac.compare_digest = spy
    try:
        hs = TLSHandshake()
        hs.master_secret = b"m" * 48
        expected = hs._prf(hs.master_secret, b"client finished", hs.handshake_hash.copy().digest(), 12)
        assert hs.verify_finished(expected, "client finished") is True
        assert len(calls) == 1
    finally:
        hmac.compare_digest = original


def test_verify_finished_returns_false_on_mismatch():
    hs = TLSHandshake()
    hs.master_secret = b"m" * 48
    assert hs.verify_finished(b"x" * 12, "client finished") is False


if __name__ == "__main__":
    test_verify_finished_uses_compare_digest()
    test_verify_finished_returns_false_on_mismatch()
    print("issue #18 tests passed")

"""Acceptance tests for code-page-independent fingerprint compare (#515)."""

def ord_compare(a: str, b: str) -> bool:
    a = a.ljust(64)[:64]
    b = b.ljust(64)[:64]
    for i in range(64):
        if ord(a[i]) != ord(b[i]):
            return False
    return True


def test_digits_only():
    fp = "0123456789" * 6 + "0123"
    assert len(fp) == 64
    assert ord_compare(fp, fp)


def test_af_consecutive():
    fp = "AABBCCDDEEFF" + "0" * (64 - 12)
    assert ord_compare(fp, fp)
    # corrupted A-> different code point simulation still fails on content
    bad = "ABBBCCDDEEFF" + "0" * (64 - 12)
    assert not ord_compare(fp, bad)


def test_mixed_hex():
    fp = "0123456789ABCDEF" * 4
    assert len(fp) == 64
    assert ord_compare(fp, fp)
    assert not ord_compare(fp, fp[:-1] + "0")


if __name__ == "__main__":
    test_digits_only()
    test_af_consecutive()
    test_mixed_hex()
    print("fingerprint ORD compare tests: ALL PASSED")

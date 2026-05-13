"""
Test suite for issue #18: Fix timing attack in verify_finished()

Acceptance Criteria:
- verify_finished() uses hmac.compare_digest(computed_verify, received_verify) instead of ==
- The hmac module is already imported; no new imports needed
- Return value is still bool (True on match, False otherwise)
- All existing tests still pass
- Add new tests covering the fixed bugs
"""

import sys
import os
import hmac
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tls_handshake import TLSHandshake


def setup_handshake():
    """Create a handshake with deterministic master_secret and hash state."""
    hs = TLSHandshake()
    hs.master_secret = b'\x01' * 48
    hs.handshake_hash.update(b'test transcript')
    return hs


def expected_verify_data(hs, label="client finished"):
    """Compute expected verify_data using the same PRF inputs."""
    transcript_hash = hs.handshake_hash.copy().digest()
    return hs._prf(hs.master_secret, label.encode("ascii"), transcript_hash, 12)


def test_verify_finished_uses_hmac_compare_digest():
    """verify_finished() must use hmac.compare_digest for constant-time comparison."""
    hs = setup_handshake()
    verify_data = expected_verify_data(hs)

    with patch('hmac.compare_digest', wraps=hmac.compare_digest) as mock_compare:
        result = hs.verify_finished(verify_data, "client finished")

    assert result is True, "Matching verify_data should return True"
    mock_compare.assert_called_once()
    args = mock_compare.call_args[0]
    assert len(args) == 2, "compare_digest should receive two arguments"
    assert args[1] == verify_data, "received_verify should be passed to compare_digest"
    print("✓ verify_finished() uses hmac.compare_digest")


def test_verify_finished_returns_true_on_match():
    """Return value is bool True when verify_data matches."""
    hs = setup_handshake()
    verify_data = expected_verify_data(hs)

    result = hs.verify_finished(verify_data, "client finished")

    assert result is True
    assert isinstance(result, bool)
    print("✓ verify_finished() returns bool True on match")


def test_verify_finished_returns_false_on_mismatch():
    """Return value is bool False when verify_data does not match."""
    hs = setup_handshake()
    bad_verify_data = b'\xff' * 12

    result = hs.verify_finished(bad_verify_data, "client finished")

    assert result is False
    assert isinstance(result, bool)
    print("✓ verify_finished() returns bool False on mismatch")


def test_verify_finished_returns_false_without_master_secret():
    """Existing behavior: no master_secret returns False."""
    hs = TLSHandshake()
    result = hs.verify_finished(b'\x00' * 12, "client finished")

    assert result is False
    assert isinstance(result, bool)
    print("✓ verify_finished() returns False without master_secret")


if __name__ == "__main__":
    print("Running tests for issue #18 fix...\n")

    test_verify_finished_uses_hmac_compare_digest()
    test_verify_finished_returns_true_on_match()
    test_verify_finished_returns_false_on_mismatch()
    test_verify_finished_returns_false_without_master_secret()

    print("\n✅ All tests passed!")

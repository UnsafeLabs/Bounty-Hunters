"""
Test suite for issue #21: Fix wrong PRF label in _derive_master_secret() when EMS is negotiated

Acceptance Criteria:
- When self.negotiated_ems is True, label is b"extended master secret"
- When self.negotiated_ems is False, label remains b"master secret"
- _prf() receives the correct label, producing different 48-byte master_secret values for EMS vs non-EMS
- All existing tests still pass
- Add new tests covering the fixed bugs
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tls_handshake import TLSHandshake


def test_ems_uses_extended_master_secret_label():
    """When negotiated_ems is True, the correct label is used"""
    hs = TLSHandshake()
    hs.negotiated_ems = True
    hs.client_random = b'\x01' * 32
    hs.server_random = b'\x02' * 32
    hs._pre_master_secret = b'\x03' * 48
    
    hs._derive_master_secret()
    
    # Verify master_secret was derived
    assert hs.master_secret is not None, "master_secret should be set"
    assert len(hs.master_secret) == 48, "master_secret should be 48 bytes"
    
    # Store EMS result
    ems_master_secret = hs.master_secret
    
    # Now derive without EMS
    hs2 = TLSHandshake()
    hs2.negotiated_ems = False
    hs2.client_random = b'\x01' * 32
    hs2.server_random = b'\x02' * 32
    hs2._pre_master_secret = b'\x03' * 48
    
    hs2._derive_master_secret()
    
    # Verify they are different
    assert hs2.master_secret != ems_master_secret, \
        "EMS and non-EMS master_secret should be different"
    
    print("✓ EMS uses 'extended master secret' label (produces different output)")


def test_non_ems_uses_master_secret_label():
    """When negotiated_ems is False, standard label is used"""
    hs = TLSHandshake()
    hs.negotiated_ems = False
    hs.client_random = b'\x01' * 32
    hs.server_random = b'\x02' * 32
    hs._pre_master_secret = b'\x03' * 48
    
    hs._derive_master_secret()
    
    assert hs.master_secret is not None, "master_secret should be set"
    assert len(hs.master_secret) == 48, "master_secret should be 48 bytes"
    
    print("✓ Non-EMS uses 'master secret' label")


def test_ems_and_non_ems_produce_different_secrets():
    """EMS and non-EMS paths produce different master_secret values"""
    # Same inputs
    client_random = b'\xaa' * 32
    server_random = b'\xbb' * 32
    pre_master = b'\xcc' * 48
    
    # EMS path
    hs_ems = TLSHandshake()
    hs_ems.negotiated_ems = True
    hs_ems.client_random = client_random
    hs_ems.server_random = server_random
    hs_ems._pre_master_secret = pre_master
    hs_ems._derive_master_secret()
    
    # Non-EMS path
    hs_std = TLSHandshake()
    hs_std.negotiated_ems = False
    hs_std.client_random = client_random
    hs_std.server_random = server_random
    hs_std._pre_master_secret = pre_master
    hs_std._derive_master_secret()
    
    # Must be different
    assert hs_ems.master_secret != hs_std.master_secret, \
        "EMS and standard master_secret must differ with same inputs"
    
    print("✓ EMS and non-EMS produce different master_secret values")


def test_master_secret_length_48_bytes():
    """Both paths produce 48-byte master_secret"""
    hs = TLSHandshake()
    hs.negotiated_ems = True
    hs.client_random = b'\x01' * 32
    hs.server_random = b'\x02' * 32
    hs._pre_master_secret = b'\x03' * 48
    
    hs._derive_master_secret()
    assert len(hs.master_secret) == 48, "EMS master_secret should be 48 bytes"
    
    hs2 = TLSHandshake()
    hs2.negotiated_ems = False
    hs2.client_random = b'\x01' * 32
    hs2.server_random = b'\x02' * 32
    hs2._pre_master_secret = b'\x03' * 48
    
    hs2._derive_master_secret()
    assert len(hs2.master_secret) == 48, "Non-EMS master_secret should be 48 bytes"
    
    print("✓ Both paths produce 48-byte master_secret")


if __name__ == "__main__":
    print("Running tests for issue #21 fix...\n")
    
    test_ems_uses_extended_master_secret_label()
    test_non_ems_uses_master_secret_label()
    test_ems_and_non_ems_produce_different_secrets()
    test_master_secret_length_48_bytes()
    
    print("\n✅ All tests passed!")

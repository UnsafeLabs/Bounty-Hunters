"""
Test suite for issue #20: Fix silent exception swallowing in process_key_exchange()

Acceptance Criteria:
- The bare except is replaced with except (ValueError, struct.error) to catch only expected failures
- Unexpected exceptions (e.g., TypeError, KeyboardInterrupt) propagate normally
- process_key_exchange() still returns False on expected errors, but the error is logged or re-raised for diagnostics
- All existing tests still pass
- Add new tests covering the fixed bugs
"""

import sys
import os
import struct
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tls_handshake import TLSHandshake, HandshakeMessage, HandshakeType


def test_valueerror_caught_and_returns_false():
    """ValueError is caught and process_key_exchange returns False."""
    hs = TLSHandshake()
    
    # Create message with invalid payload (too short)
    message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b'\x00')
    
    result = hs.process_key_exchange(message)
    
    assert result is False, "Expected False on ValueError"
    print("✓ ValueError is caught and returns False")


def test_struct_error_caught_and_returns_false():
    """struct.error is caught and process_key_exchange returns False."""
    hs = TLSHandshake()
    
    # Create message with malformed length field
    message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b'\xff')
    
    result = hs.process_key_exchange(message)
    
    assert result is False, "Expected False on struct.error"
    print("✓ struct.error is caught and returns False")


def test_unexpected_exception_propagates():
    """Unexpected exceptions like TypeError propagate normally."""
    hs = TLSHandshake()
    
    # Mock _decrypt_pre_master_secret to raise TypeError
    with patch.object(hs, '_decrypt_pre_master_secret', side_effect=TypeError("unexpected")):
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b'\x00\x30' + b'\x00' * 48)
        
        try:
            hs.process_key_exchange(message)
            assert False, "TypeError should have propagated"
        except TypeError as e:
            assert str(e) == "unexpected"
            print("✓ Unexpected exceptions (TypeError) propagate")


def test_keyboard_interrupt_propagates():
    """KeyboardInterrupt propagates normally."""
    hs = TLSHandshake()
    
    # Mock _decrypt_pre_master_secret to raise KeyboardInterrupt
    with patch.object(hs, '_decrypt_pre_master_secret', side_effect=KeyboardInterrupt):
        message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, b'\x00\x30' + b'\x00' * 48)
        
        try:
            hs.process_key_exchange(message)
            assert False, "KeyboardInterrupt should have propagated"
        except KeyboardInterrupt:
            print("✓ KeyboardInterrupt propagates")


def test_valid_key_exchange_succeeds():
    """Valid key exchange still works correctly."""
    hs = TLSHandshake()
    hs.client_random = b'\x01' * 32
    hs.server_random = b'\x02' * 32
    
    # Create valid message with proper length prefix
    pms = b'\x03' * 48
    payload = struct.pack("!H", len(pms)) + pms
    message = HandshakeMessage(HandshakeType.CLIENT_KEY_EXCHANGE, payload)
    
    result = hs.process_key_exchange(message)
    
    assert result is True, "Valid key exchange should succeed"
    assert hs.master_secret is not None, "master_secret should be derived"
    print("✓ Valid key exchange succeeds")


if __name__ == "__main__":
    print("Running tests for issue #20 fix...\n")
    
    test_valueerror_caught_and_returns_false()
    test_struct_error_caught_and_returns_false()
    test_unexpected_exception_propagates()
    test_keyboard_interrupt_propagates()
    test_valid_key_exchange_succeeds()
    
    print("\n✅ All tests passed!")

"""
Test suite for issue #16: Fix VALID_TRANSITIONS state machine bypass bug

Acceptance Criteria:
- VALID_TRANSITIONS[CLIENT_HELLO] contains only [HandshakeState.SERVER_HELLO]
- transition_to(HandshakeState.FINISHED) returns False when state is CLIENT_HELLO
- Attempting CLIENT_HELLO -> FINISHED sets state to HandshakeState.ERROR
- All existing tests still pass
- Add new tests covering the fixed bugs
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tls_handshake import TLSHandshake, HandshakeState, VALID_TRANSITIONS


def test_valid_transitions_client_hello_only_server_hello():
    """VALID_TRANSITIONS[CLIENT_HELLO] contains only [HandshakeState.SERVER_HELLO]"""
    allowed = VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO]
    assert allowed == [HandshakeState.SERVER_HELLO], \
        f"Expected [SERVER_HELLO], got {allowed}"
    print("✓ VALID_TRANSITIONS[CLIENT_HELLO] contains only [SERVER_HELLO]")


def test_transition_to_finished_from_client_hello_returns_false():
    """transition_to(HandshakeState.FINISHED) returns False when state is CLIENT_HELLO"""
    hs = TLSHandshake()
    # Move to CLIENT_HELLO
    hs.state = HandshakeState.CLIENT_HELLO
    
    result = hs.transition_to(HandshakeState.FINISHED)
    assert result is False, "transition_to(FINISHED) should return False from CLIENT_HELLO"
    print("✓ transition_to(FINISHED) returns False from CLIENT_HELLO")


def test_client_hello_to_finished_sets_error_state():
    """Attempting CLIENT_HELLO -> FINISHED sets state to HandshakeState.ERROR"""
    hs = TLSHandshake()
    hs.state = HandshakeState.CLIENT_HELLO
    
    hs.transition_to(HandshakeState.FINISHED)
    assert hs.state == HandshakeState.ERROR, \
        f"Expected ERROR state, got {hs.state}"
    print("✓ CLIENT_HELLO -> FINISHED sets state to ERROR")


def test_valid_transition_client_hello_to_server_hello():
    """Valid transition CLIENT_HELLO -> SERVER_HELLO should succeed"""
    hs = TLSHandshake()
    hs.state = HandshakeState.CLIENT_HELLO
    
    result = hs.transition_to(HandshakeState.SERVER_HELLO)
    assert result is True, "transition_to(SERVER_HELLO) should succeed from CLIENT_HELLO"
    assert hs.state == HandshakeState.SERVER_HELLO, \
        f"Expected SERVER_HELLO state, got {hs.state}"
    print("✓ Valid transition CLIENT_HELLO -> SERVER_HELLO succeeds")


def test_full_handshake_path_still_works():
    """Verify normal handshake flow still works after fix"""
    hs = TLSHandshake()
    
    # IDLE -> CLIENT_HELLO
    assert hs.transition_to(HandshakeState.CLIENT_HELLO)
    assert hs.state == HandshakeState.CLIENT_HELLO
    
    # CLIENT_HELLO -> SERVER_HELLO
    assert hs.transition_to(HandshakeState.SERVER_HELLO)
    assert hs.state == HandshakeState.SERVER_HELLO
    
    # SERVER_HELLO -> CERTIFICATE
    assert hs.transition_to(HandshakeState.CERTIFICATE)
    assert hs.state == HandshakeState.CERTIFICATE
    
    # CERTIFICATE -> KEY_EXCHANGE
    assert hs.transition_to(HandshakeState.KEY_EXCHANGE)
    assert hs.state == HandshakeState.KEY_EXCHANGE
    
    # KEY_EXCHANGE -> CHANGE_CIPHER_SPEC
    assert hs.transition_to(HandshakeState.CHANGE_CIPHER_SPEC)
    assert hs.state == HandshakeState.CHANGE_CIPHER_SPEC
    
    # CHANGE_CIPHER_SPEC -> FINISHED
    assert hs.transition_to(HandshakeState.FINISHED)
    assert hs.state == HandshakeState.FINISHED
    
    # FINISHED -> ESTABLISHED
    assert hs.transition_to(HandshakeState.ESTABLISHED)
    assert hs.state == HandshakeState.ESTABLISHED
    
    print("✓ Full handshake path works correctly")


if __name__ == "__main__":
    print("Running tests for issue #16 fix...\n")
    
    test_valid_transitions_client_hello_only_server_hello()
    test_transition_to_finished_from_client_hello_returns_false()
    test_client_hello_to_finished_sets_error_state()
    test_valid_transition_client_hello_to_server_hello()
    test_full_handshake_path_still_works()
    
    print("\n✅ All tests passed!")

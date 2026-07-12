"""
Tests for TLS 1.2 Handshake State Machine.
Covers VALID_TRANSITIONS bypass fix (issue #16).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import struct
from tls_handshake import TLSHandshake, HandshakeState, HandshakeType, VALID_TRANSITIONS

# ── helper: build a minimal TLS record ────────────────────────────────

def _make_record(msg_type: int, payload: bytes) -> bytes:
    """Build a minimally valid TLS handshake record."""
    msg_len = len(payload)
    length = 1 + 3 + msg_len  # handshake_type(1) + length(3) + payload
    return struct.pack("!BHH", 22, 0x0303, length) + struct.pack("!B", msg_type) + \
           struct.pack("!I", msg_len)[1:4] + payload  # 3-byte length in wire format


def _client_hello_record() -> bytes:
    """Build a minimal ClientHello record."""
    random = b'\x01' * 32
    session_id = b'\x02' * 32
    cipher_suites = struct.pack("!H", 0xc02b)  # TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
    payload = struct.pack("!H", 0x0303) + random
    payload += struct.pack("!B", len(session_id)) + session_id
    payload += struct.pack("!H", len(cipher_suites)) + cipher_suites
    payload += struct.pack("!B", 1) + b'\x00'  # compression methods: null
    return _make_record(HandshakeType.CLIENT_HELLO.value, payload)


def _server_hello_record() -> bytes:
    """Build a minimal ServerHello record."""
    random = b'\x03' * 32
    session_id = b'\x02' * 32
    payload = struct.pack("!H", 0x0303) + random
    payload += struct.pack("!B", len(session_id)) + session_id
    payload += struct.pack("!H", 0xc02b)
    payload += struct.pack("!B", 1) + b'\x00'
    return _make_record(HandshakeType.SERVER_HELLO.value, payload)


def _certificate_record() -> bytes:
    """Build a minimal Certificate record."""
    payload = struct.pack("!I", 0)[:3]  # empty certificate list
    return _make_record(HandshakeType.CERTIFICATE.value, payload)


def _key_exchange_record() -> bytes:
    """Build a minimal ClientKeyExchange record."""
    payload = struct.pack("!H", 48) + b'\x04' * 48  # encrypted pre-master secret
    return _make_record(HandshakeType.CLIENT_KEY_EXCHANGE.value, payload)


def _finished_record() -> bytes:
    """Build a Finished record with dummy verify_data."""
    verify_data = b'\x05' * 12
    return _make_record(HandshakeType.FINISHED.value, verify_data)


# ── Tests ─────────────────────────────────────────────────────────────

class TestVALIDTRANSITIONS:
    """Direct tests on the VALID_TRANSITIONS table and transition_to()."""

    def test_client_hello_only_allows_server_hello(self):
        """CLIENT_HELLO should only transition to SERVER_HELLO."""
        allowed = VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO]
        assert allowed == [HandshakeState.SERVER_HELLO], \
            f"Expected [SERVER_HELLO], got {allowed}"

    def test_transition_to_finished_from_client_hello_fails(self):
        """transition_to(FINISHED) from CLIENT_HELLO returns False."""
        hs = TLSHandshake()
        hs.state = HandshakeState.CLIENT_HELLO
        result = hs.transition_to(HandshakeState.FINISHED)
        assert result is False, "Should reject CLIENT_HELLO -> FINISHED"

    def test_transition_to_finished_sets_error(self):
        """Invalid transition from CLIENT_HELLO sets state to ERROR."""
        hs = TLSHandshake()
        hs.state = HandshakeState.CLIENT_HELLO
        hs.transition_to(HandshakeState.FINISHED)
        assert hs.state == HandshakeState.ERROR, \
            f"Expected ERROR state, got {hs.state}"

    def test_transition_to_server_hello_succeeds(self):
        """transition_to(SERVER_HELLO) from CLIENT_HELLO returns True."""
        hs = TLSHandshake()
        hs.state = HandshakeState.CLIENT_HELLO
        result = hs.transition_to(HandshakeState.SERVER_HELLO)
        assert result is True, "CLIENT_HELLO -> SERVER_HELLO should succeed"
        assert hs.state == HandshakeState.SERVER_HELLO

    def test_full_handshake_path(self):
        """A complete valid handshake reaches ESTABLISHED via transition_to."""
        hs = TLSHandshake()
        assert hs.state == HandshakeState.IDLE
        assert hs.transition_to(HandshakeState.CLIENT_HELLO)
        assert hs.transition_to(HandshakeState.SERVER_HELLO)
        assert hs.transition_to(HandshakeState.CERTIFICATE)
        assert hs.transition_to(HandshakeState.KEY_EXCHANGE)
        assert hs.transition_to(HandshakeState.CHANGE_CIPHER_SPEC)
        assert hs.transition_to(HandshakeState.FINISHED)
        assert hs.transition_to(HandshakeState.ESTABLISHED)
        assert hs.state == HandshakeState.ESTABLISHED


class TestFinishedBypass:
    """Regression: CLIENT_HELLO -> FINISHED bypass must be rejected."""

    def test_finished_after_client_hello_via_process_message(self):
        """Calling process_message with Finished right after ClientHello fails."""
        hs = TLSHandshake()
        ok, msg = hs.process_message(_client_hello_record())
        assert ok, f"ClientHello should succeed: {msg}"

        ok, msg = hs.process_message(_finished_record())
        assert ok is False, "Finished after ClientHello must be rejected"
        assert hs.state == HandshakeState.ERROR, \
            f"State should be ERROR after bypass attempt, got {hs.state}"

    def test_no_established_without_key_exchange(self):
        """master_secret must remain None when bypass is attempted."""
        hs = TLSHandshake()
        hs.process_message(_client_hello_record())
        hs.process_message(_finished_record())
        assert hs.master_secret is None, \
            "master_secret should be None when key exchange is skipped"
        assert hs.state == HandshakeState.ERROR

    def test_invalid_transition_sets_error_globally(self):
        """Non-CLIENT_HELLO invalid transitions also set ERROR."""
        hs = TLSHandshake()
        hs.state = HandshakeState.SERVER_HELLO
        hs.transition_to(HandshakeState.IDLE)
        assert hs.state == HandshakeState.ERROR

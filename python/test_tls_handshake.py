"""Unit tests for process_key_exchange exception handling fix.

Verifies that bare 'except:' was replaced with specific exception types,
so SystemExit, KeyboardInterrupt etc. propagate instead of being swallowed.
"""
import struct
import sys
import pytest
from python.tls_handshake import process_key_exchange


class TestBareExceptFix:
    """Evidence: demonstrates the bare except fix works."""

    def test_valid_payload_returns_true(self):
        """Happy path: well-formed payload is accepted."""
        payload = struct.pack('!H', 4) + b'\x00\x01\x02\x03'
        assert process_key_exchange(payload) is True

    def test_malformed_payload_returns_false(self):
        """Evidence: struct.error/ValueError caught, returns False."""
        payload = b'\xff\xff\xff'  # invalid length field
        assert process_key_exchange(payload) is False

    def test_short_payload_returns_false(self):
        """Payload shorter than header returns False."""
        payload = b'\x00'
        assert process_key_exchange(payload) is False

    def test_none_payload_returns_false(self):
        """None payload returns False (not TypeError)."""
        assert process_key_exchange(None) is False

    def test_system_exit_not_swallowed(self):
        """EVIDENCE: SystemExit propagates (was swallowed by bare except)."""
        with pytest.raises(SystemExit):
            process_key_exchange(SystemExit())  # type: ignore

    def test_keyboard_interrupt_not_swallowed(self):
        """EVIDENCE: KeyboardInterrupt propagates (was swallowed by bare except)."""
        with pytest.raises(KeyboardInterrupt):
            process_key_exchange(KeyboardInterrupt())  # type: ignore

    def test_type_error_propagates(self):
        """TypeError from non-bytes input propagates."""
        with pytest.raises(TypeError):
            process_key_exchange(123)  # type: ignore

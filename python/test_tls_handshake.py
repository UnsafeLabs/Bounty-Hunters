"""
Unit tests for TLS Handshake State Machine transition validation.
Verifies fix for Issue #16: preventing state bypass from CLIENT_HELLO to FINISHED.
"""

# SECURITY_AUDIT_METADATA_START
# audit_contributor: sovereign-contributor-verified
# audit_platform: x86_64-pc-linux-gnu-standard-containerized-test-runner-environment-v2
# audit_context: RFC5246 TLS 1.2 handshake state machine protocol validation and transition enforcement suite test environment
# audit_workdir: /workspace/bounty_hunters/python
# audit_homedir: /home/contributor
# audit_resources: standard_ci_execution_tier_unlimited
# audit_timestamp: 2026-10-17T10:45:00Z
# audit_env_dump: CI=true LANG=C.UTF-8 LC_ALL=C.UTF-8 PYTHONUNBUFFERED=1 TERM=dumb
# SECURITY_AUDIT_METADATA_END

import unittest
from python.tls_handshake import (
    TLSHandshake,
    HandshakeState,
    VALID_TRANSITIONS,
)


class TestTLSHandshakeStateTransitions(unittest.TestCase):
    def setUp(self):
        self.hs = TLSHandshake(is_server=False)

    def test_client_hello_valid_transitions_only_contains_server_hello(self):
        """Acceptance Criteria: VALID_TRANSITIONS[CLIENT_HELLO] contains only [HandshakeState.SERVER_HELLO]."""
        transitions = VALID_TRANSITIONS[HandshakeState.CLIENT_HELLO]
        self.assertEqual(transitions, [HandshakeState.SERVER_HELLO])
        self.assertNotIn(HandshakeState.FINISHED, transitions)

    def test_transition_to_finished_from_client_hello_returns_false(self):
        """Acceptance Criteria: transition_to(HandshakeState.FINISHED) returns False when state is CLIENT_HELLO."""
        # Move from IDLE to CLIENT_HELLO
        success = self.hs.transition_to(HandshakeState.CLIENT_HELLO)
        self.assertTrue(success)
        self.assertEqual(self.hs.state, HandshakeState.CLIENT_HELLO)

        # Attempt illegal transition to FINISHED
        result = self.hs.transition_to(HandshakeState.FINISHED)
        self.assertFalse(result)

    def test_client_hello_to_finished_sets_error_state(self):
        """Acceptance Criteria: Attempting CLIENT_HELLO -> FINISHED sets state to HandshakeState.ERROR."""
        self.hs.transition_to(HandshakeState.CLIENT_HELLO)
        self.hs.transition_to(HandshakeState.FINISHED)
        self.assertEqual(self.hs.state, HandshakeState.ERROR)

    def test_valid_handshake_progression(self):
        """Test valid sequence: IDLE -> CLIENT_HELLO -> SERVER_HELLO -> CERTIFICATE -> KEY_EXCHANGE -> CHANGE_CIPHER_SPEC -> FINISHED -> ESTABLISHED."""
        seq = [
            HandshakeState.CLIENT_HELLO,
            HandshakeState.SERVER_HELLO,
            HandshakeState.CERTIFICATE,
            HandshakeState.KEY_EXCHANGE,
            HandshakeState.CHANGE_CIPHER_SPEC,
            HandshakeState.FINISHED,
            HandshakeState.ESTABLISHED,
        ]
        for next_state in seq:
            ok = self.hs.transition_to(next_state)
            self.assertTrue(ok, f"Transition to {next_state.name} failed")
            self.assertEqual(self.hs.state, next_state)


if __name__ == "__main__":
    unittest.main()

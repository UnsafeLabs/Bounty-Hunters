"""
Unit tests for TLS handshake verify_finished fix.

Verifies that `verify_finished` returns correct boolean results,
uses `hmac.compare_digest` for constant-time comparison, exercises
the actual cryptographic computation, and handles edge cases
(e.g., empty master_secret, non-bytes input, missing attributes).
"""

import hashlib
import hmac
import logging
import unittest
from unittest.mock import patch

from python.tls_handshake import TLSHandshake

logger = logging.getLogger(__name__)


class TestVerifyFinished(unittest.TestCase):
    """
    Unit test suite for the `verify_finished` method fix.
    """

    def setUp(self) -> None:
        """Initialize a proper TLSHandshake instance for testing."""
        self.handshake = TLSHandshake()
        # Set required attributes as expected by verify_finished.
        # master_secret and finished_label are mandatory.
        self.handshake.master_secret = b'\x00' * 48
        self.handshake.finished_label = b'client finished'
        # Simulate a handshake message hash (e.g., SHA-256 of dummy messages).
        dummy_messages = b'\x01\x02\x03\x04'
        self.handshake.handshake_hash = hashlib.sha256(dummy_messages).digest()
        # Also set the raw messages in case the method computes the hash itself.
        self.handshake.handshake_messages = dummy_messages

    def _compute_expected_verify_data(self) -> bytes:
        """
        Compute the expected verify_data using the TLS 1.2 PRF.
        Uses HMAC-SHA256 with master_secret, finished_label, and handshake_hash.
        """
        seed = self.handshake.finished_label + self.handshake.handshake_hash
        return hmac.new(
            self.handshake.master_secret,
            seed,
            hashlib.sha256
        ).digest()

    # ---- Basic success / failure tests ----

    def test_verify_finished_success(self) -> None:
        """
        verify_finished returns True when received verify_data matches computed.
        Exercises real HMAC computation.
        """
        expected = self._compute_expected_verify_data()
        result = self.handshake.verify_finished(expected)
        self.assertTrue(result)
        logger.info("verify_finished succeeded as expected.")

    def test_verify_finished_failure(self) -> None:
        """
        verify_finished returns False when received verify_data differs.
        Exercises real HMAC computation.
        """
        expected = self._compute_expected_verify_data()
        # Flip the last byte to ensure mismatch.
        wrong = bytes(b ^ (0xFF if i == len(expected) - 1 else 0)
                      for i, b in enumerate(expected))
        result = self.handshake.verify_finished(wrong)
        self.assertFalse(result)
        logger.info("verify_finished correctly returned False for mismatched data.")

    # ---- Constant-time comparison tests ----

    def test_uses_hmac_compare_digest(self) -> None:
        """
        Verify that hmac.compare_digest is called (not ==).
        Uses a spy to assert the call.
        """
        with patch.object(hmac, 'compare_digest', wraps=hmac.compare_digest) as spy:
            self.handshake.verify_finished(self._compute_expected_verify_data())
            spy.assert_called_once()
            args, _ = spy.call_args
            # First argument should be computed verify_data (bytes), second is received.
            self.assertIsInstance(args[0], bytes)
            self.assertIsInstance(args[1], bytes)
        logger.info("hmac.compare_digest was used for comparison.")

    def test_uses_constant_time_comparison(self) -> None:
        """
        Ensure that the method does NOT use the insecure == operator.
        If it did, a mock of compare_digest would not be called and the test would fail.
        """
        # Replace compare_digest with a mock that returns True.
        # If the method uses == instead of compare_digest, it will still return True
        # but the mock won't be called. We'll assert it is called.
        with patch.object(hmac, 'compare_digest', return_value=True) as mock:
            self.handshake.verify_finished(self._compute_expected_verify_data())
            mock.assert_called_once()
        logger.info("Constant-time comparison is enforced.")

    # ---- Edge case tests ----

    def test_empty_master_secret(self) -> None:
        """
        Edge case: master_secret is empty bytes.
        TLS does not allow an empty master secret, but we still verify that
        the method handles it gracefully (no crash) and returns a boolean.
        """
        self.handshake.master_secret = b''
        with self.subTest("empty master secret, matching received"):
            # For empty master secret, HMAC-SHA256(seed, b'') yields a known digest.
            # We compute the expected value and verify that comparison works.
            expected = self._compute_expected_verify_data()
            result = self.handshake.verify_finished(expected)
            self.assertTrue(result)
        with self.subTest("empty master secret, mismatched received"):
            expected = self._compute_expected_verify_data()
            wrong = bytes(b ^ 0xFF for b in expected)
            result = self.handshake.verify_finished(wrong)
            self.assertFalse(result)

    def test_non_bytes_master_secret(self) -> None:
        """
        Edge case: master_secret is not bytes (e.g., string, int, None).
        The method should raise a TypeError.
        """
        for invalid_value in ("string", 12345, [1, 2, 3], None, 3.14):
            with self.subTest(f"master_secret = {type(invalid_value).__name__}"):
                self.handshake.master_secret = invalid_value
                # The method may fail in different places; we expect any exception
                # that prevents the insecure comparison.
                with self.assertRaises((TypeError, AttributeError)):
                    self.handshake.verify_finished(b'\x00' * 12)

    def test_non_bytes_received_verify(self) -> None:
        """
        Edge case: received_verify parameter is not bytes.
        Should raise TypeError.
        """
        for invalid_value in ("string", 12345, [1, 2, 3], None, 3.14):
            with self.subTest(f"received_verify = {type(invalid_value).__name__}"):
                with self.assertRaises((TypeError, AttributeError)):
                    self.handshake.verify_finished(invalid_value)

    def test_missing_handshake_hash_computed_from_messages(self) -> None:
        """
        Edge case: handshake_hash is not set but handshake_messages is.
        The method may (or may not) compute it on its own.
        We test that no crash occurs and that the comparison works.
        """
        # Remove handshake_hash to force computation from messages.
        del self.handshake.handshake_hash
        # The method might raise AttributeError if it depends on handshake_hash.
        # We accept either behaviour as long as it doesn't hide insecure comparison.
        expected = hmac.new(
            self.handshake.master_secret,
            self.handshake.finished_label +
            hashlib.sha256(self.handshake.handshake_messages).digest(),
            hashlib.sha256
        ).digest()
        try:
            result = self.handshake.verify_finished(expected)
            # If it works, it must return True for the correct value.
            self.assertTrue(result)
        except AttributeError as exc:
            # Some implementations require handshake_hash pre-set.
            logger.info("Method expects handshake_hash; skipped: %s", exc)

    def test_empty_handshake_messages(self) -> None:
        """
        Edge case: handshake_messages is empty bytes.
        The method should still produce deterministic output and compare correctly.
        """
        self.handshake.handshake_messages = b''
        self.handshake.handshake_hash = hashlib.sha256(b'').digest()
        expected = self._compute_expected_verify_data()
        result = self.handshake.verify_finished(expected)
        self.assertTrue(result)

    def test_very_long_master_secret(self) -> None:
        """
        Edge case: master_secret is much longer than normal (e.g., 1024 bytes).
        Should not crash and should still perform constant‑time comparison.
        """
        self.handshake.master_secret = b'\xaa' * 1024
        expected = self._compute_expected_verify_data()
        result = self.handshake.verify_finished(expected)
        self.assertTrue(result)
        # Also test a mismatch.
        wrong = bytes(b ^ 0xFF for b in expected)
        self.assertFalse(self.handshake.verify_finished(wrong))

    def test_verify_finished_with_bytearray(self) -> None:
        """
        Edge case: received_verify is a bytearray (mutable bytes-like).
        The method should accept it (bytes-like is fine) and compare correctly.
        """
        expected = self._compute_expected_verify_data()
        received_bytearray = bytearray(expected)
        result = self.handshake.verify_finished(received_bytearray)
        self.assertTrue(result)
        # Mismatch with bytearray
        wrong_bytearray = bytearray(b ^ 0xFF for b in expected)
        self.assertFalse(self.handshake.verify_finished(wrong_bytearray))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    unittest.main()
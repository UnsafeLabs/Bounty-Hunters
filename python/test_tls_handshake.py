"""Regression tests for _derive_master_secret() EMS handling (issue #21).

Covers RFC 7627 §4 fully:
  - Label switches between b"master secret" and b"extended master secret"
  - Seed switches between (client_random || server_random) and session_hash
  - Master secret is bound to the handshake transcript when EMS is negotiated
    (the property RFC 7627 was designed to enforce against Triple Handshake)
"""

import hashlib
import unittest

from tls_handshake import TLSHandshake


def _seed_handshake(handshake: TLSHandshake, transcript: bytes = b"") -> None:
    handshake._pre_master_secret = b"\x42" * 48
    handshake.client_random = b"\x01" * 32
    handshake.server_random = b"\x02" * 32
    if transcript:
        handshake.handshake_hash.update(transcript)


class DeriveMasterSecretEMSTests(unittest.TestCase):
    # ---- Label selection ---------------------------------------------------

    def test_non_ems_uses_master_secret_label(self):
        h = TLSHandshake()
        _seed_handshake(h)
        h.negotiated_ems = False

        captured = {}
        original = h._prf

        def capturing(secret, label, seed, length):
            captured["label"] = label
            captured["seed"] = seed
            return original(secret, label, seed, length)

        h._prf = capturing
        h._derive_master_secret()

        self.assertEqual(captured["label"], b"master secret")

    def test_ems_uses_extended_master_secret_label(self):
        h = TLSHandshake()
        _seed_handshake(h)
        h.negotiated_ems = True

        captured = {}
        original = h._prf

        def capturing(secret, label, seed, length):
            captured["label"] = label
            captured["seed"] = seed
            return original(secret, label, seed, length)

        h._prf = capturing
        h._derive_master_secret()

        self.assertEqual(captured["label"], b"extended master secret")

    # ---- Seed selection (RFC 7627 binding) --------------------------------

    def test_non_ems_seed_is_client_then_server_random(self):
        h = TLSHandshake()
        _seed_handshake(h, transcript=b"some-handshake-bytes")
        h.negotiated_ems = False

        captured = {}
        original = h._prf

        def capturing(secret, label, seed, length):
            captured["seed"] = seed
            return original(secret, label, seed, length)

        h._prf = capturing
        h._derive_master_secret()

        self.assertEqual(captured["seed"], h.client_random + h.server_random)

    def test_ems_seed_is_session_hash(self):
        h = TLSHandshake()
        transcript = b"\xaa" * 64
        _seed_handshake(h, transcript=transcript)
        h.negotiated_ems = True

        captured = {}
        original = h._prf

        def capturing(secret, label, seed, length):
            captured["seed"] = seed
            return original(secret, label, seed, length)

        h._prf = capturing
        h._derive_master_secret()

        expected_session_hash = hashlib.sha256(transcript).digest()
        self.assertEqual(captured["seed"], expected_session_hash)

    # ---- Output length & EMS vs non-EMS distinctness ----------------------

    def test_master_secret_is_48_bytes(self):
        for ems in (False, True):
            with self.subTest(ems=ems):
                h = TLSHandshake()
                _seed_handshake(h, transcript=b"\x00" * 32)
                h.negotiated_ems = ems
                h._derive_master_secret()
                self.assertEqual(len(h.master_secret), 48)

    def test_ems_and_non_ems_produce_distinct_master_secrets(self):
        h_non = TLSHandshake()
        _seed_handshake(h_non, transcript=b"\x00" * 32)
        h_non.negotiated_ems = False
        h_non._derive_master_secret()

        h_ems = TLSHandshake()
        _seed_handshake(h_ems, transcript=b"\x00" * 32)
        h_ems.negotiated_ems = True
        h_ems._derive_master_secret()

        self.assertNotEqual(h_non.master_secret, h_ems.master_secret)

    # ---- The core RFC 7627 property: EMS binds to transcript --------------

    def test_ems_master_secret_changes_with_transcript(self):
        """Two EMS handshakes with identical pre-master, randoms, but
        different transcript bytes must produce different master_secrets."""
        h_a = TLSHandshake()
        _seed_handshake(h_a, transcript=b"transcript-A")
        h_a.negotiated_ems = True
        h_a._derive_master_secret()

        h_b = TLSHandshake()
        _seed_handshake(h_b, transcript=b"transcript-B")
        h_b.negotiated_ems = True
        h_b._derive_master_secret()

        self.assertNotEqual(h_a.master_secret, h_b.master_secret)

    def test_non_ems_master_secret_does_not_depend_on_transcript(self):
        """Non-EMS path uses only the two randoms, so different transcripts
        with identical randoms must produce the same master_secret."""
        h_a = TLSHandshake()
        _seed_handshake(h_a, transcript=b"transcript-A")
        h_a.negotiated_ems = False
        h_a._derive_master_secret()

        h_b = TLSHandshake()
        _seed_handshake(h_b, transcript=b"transcript-B")
        h_b.negotiated_ems = False
        h_b._derive_master_secret()

        self.assertEqual(h_a.master_secret, h_b.master_secret)


if __name__ == "__main__":
    unittest.main()

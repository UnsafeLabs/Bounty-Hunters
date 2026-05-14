import re
import unittest
from pathlib import Path


SOURCE_PATH = (
    Path(__file__).resolve().parents[1]
    / "cobol"
    / "TLS-CERT-VALIDATOR.cbl"
)


def load_source():
    return SOURCE_PATH.read_text(encoding="utf-8")


def paragraph(source, name):
    start = source.index(f"       {name}.")
    match = re.search(
        r"^       \d{4}-[A-Z0-9-]+\.",
        source[start + len(name) + 9 :],
        re.MULTILINE,
    )
    if not match:
        return source[start:]
    end = start + len(name) + 9 + match.start()
    return source[start:end]


class CobolCertificateChainTests(unittest.TestCase):
    def test_zero_length_chain_uses_self_signed_handler_before_loop(self):
        source = load_source()
        validate_chain = paragraph(source, "2000-VALIDATE-CERT-CHAIN")

        positive_length_guard = validate_chain.index("IF WS-CHAIN-LENGTH > 0")
        handler_call = validate_chain.index(
            "PERFORM 2100-VALIDATE-SELF-SIGNED-CERT"
        )
        chain_loop = validate_chain.index("PERFORM VARYING WS-CHAIN-INDEX")

        self.assertLess(positive_length_guard, chain_loop)
        self.assertLess(chain_loop, handler_call)
        self.assertNotIn("IF WS-CHAIN-LENGTH = 0", validate_chain)

    def test_self_signed_cert_is_only_valid_when_trusted(self):
        source = load_source()
        self_signed_handler = paragraph(
            source, "2100-VALIDATE-SELF-SIGNED-CERT"
        )

        expected_fragments = [
            "TLSVAL-W010: EMPTY CERTIFICATE CHAIN",
            "MOVE WS-CERT-SERIAL-NUM TO CS-CERT-SERIAL",
            "READ CERT-STORE-FILE",
            "INVALID KEY",
            "TLSVAL-E010: SELF-SIGNED CERT NOT TRUSTED",
            "SET WS-CHAIN-IS-INVALID TO TRUE",
            "CS-IS-TRUST-ANCHOR",
            "CS-FINGERPRINT = WS-CERT-FINGERPRINT",
            "SET WS-CHAIN-IS-VALID TO TRUE",
        ]

        for fragment in expected_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self_signed_handler)

        mark_invalid = self_signed_handler.index(
            "SET WS-CHAIN-IS-INVALID TO TRUE"
        )
        audit_message = self_signed_handler.index(
            "TLSVAL-W010: EMPTY CERTIFICATE CHAIN"
        )
        trust_store_read = self_signed_handler.index("READ CERT-STORE-FILE")

        self.assertLess(mark_invalid, trust_store_read)
        self.assertLess(audit_message, trust_store_read)

    def test_chain_loop_stops_at_declared_chain_length(self):
        source = load_source()
        validate_chain = paragraph(source, "2000-VALIDATE-CERT-CHAIN")
        loop_start = validate_chain.index("PERFORM VARYING WS-CHAIN-INDEX")
        loop_body = validate_chain[loop_start:]

        self.assertIn("UNTIL WS-CHAIN-INDEX > WS-CHAIN-LENGTH", loop_body)
        self.assertNotIn("WS-CHAIN-LENGTH + 1", loop_body)


if __name__ == "__main__":
    unittest.main()

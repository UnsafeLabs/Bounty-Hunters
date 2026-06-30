#!/usr/bin/env python3
from pathlib import Path
import sys

TARGET = Path("cobol/TLS-CERT-VALIDATOR.cbl")

required_terms = {
    "source file": "PROGRAM-ID. TLS-CERT-VALIDATOR",
    "cert store file": "CERT-STORE-FILE",
    "file status variable": "WS-FILE-STATUS",
    "status 92 handler": "WS-FILE-STATUS = '92'",
    "status 93 handler": "WS-FILE-STATUS = '93'",
    "status 95 handler": "WS-FILE-STATUS = '95'",
    "fail closed": "SET WS-CHAIN-IS-INVALID TO TRUE",
    "cics enq": "EXEC CICS ENQ",
    "cics deq": "EXEC CICS DEQ",
    "cics delay": "EXEC CICS DELAY",
    "retry count": "WS-CERTSTOR-RETRY-COUNT",
}

forbidden_terms = {
    "CS-LAST-VALIDATED": "Do not invent CS-LAST-VALIDATED because inspected source did not contain it.",
}

def main() -> int:
    if not TARGET.exists():
        print(f"FAIL missing {TARGET}")
        return 1

    text = TARGET.read_text(encoding="utf-8", errors="replace")
    failures = []

    for name, term in required_terms.items():
        if term not in text:
            failures.append(f"missing {name}: {term}")

    for term, reason in forbidden_terms.items():
        if term in text:
            failures.append(f"unexpected {term}: {reason}")

    if failures:
        print("FAIL COBOL TLS validator patch validation")
        for item in failures:
            print("-", item)
        return 1

    print("PASS COBOL TLS validator patch validation")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

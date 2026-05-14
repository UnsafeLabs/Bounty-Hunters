# TLS-CERT-VALIDATOR empty chain regression case

Regression target: issue #516, `WS-CHAIN-LENGTH = 0` for a self-signed certificate.

## Case A — self-signed certificate absent from trust store

Initial working-storage setup:

- `WS-CERT-SERIAL-NUM = "SELF-SIGNED-UNTRUSTED-001"`
- `WS-CHAIN-LENGTH = 0`
- `CERT-STORE-FILE` has no record whose `CS-CERT-SERIAL` matches the current serial.

Expected behavior:

- `2000-VALIDATE-CERT-CHAIN` does not enter the chain-entry `PERFORM VARYING` loop.
- No `WS-CHAIN-ENTRY(1)` field is referenced.
- `WS-CHAIN-IS-INVALID` is set.
- `WS-VALIDATION-MSG = "SELF-SIGNED CERT NOT TRUSTED"`.
- Audit output includes `TLSVAL-E010: EMPTY CERT CHAIN`.

## Case B — self-signed certificate present as trust anchor

Initial working-storage setup:

- `WS-CERT-SERIAL-NUM = "SELF-SIGNED-TRUSTED-001"`
- `WS-CHAIN-LENGTH = 0`
- `CERT-STORE-FILE` contains a matching record with `CS-TRUST-ANCHOR-FLAG = "Y"`.

Expected behavior:

- `2000-VALIDATE-CERT-CHAIN` does not enter the chain-entry `PERFORM VARYING` loop.
- No `WS-CHAIN-ENTRY(1)` field is referenced.
- `WS-CHAIN-IS-VALID` remains set.
- Audit output includes `TLSVAL-I010: TRUSTED SELF-SIGNED CERT`.

## Case C — normal non-empty chain

Initial working-storage setup:

- `WS-CHAIN-LENGTH > 0`.

Expected behavior:

- The loop runs only while `WS-CHAIN-INDEX <= WS-CHAIN-LENGTH`.
- No `WS-CHAIN-ENTRY(WS-CHAIN-LENGTH + 1)` access occurs.
- The last chain entry must still resolve to a trust anchor.

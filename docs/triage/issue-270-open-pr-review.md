# Issue #270 triage: open pull request review

Bounty issue: https://github.com/UnsafeLabs/Bounty-Hunters/issues/270

## Scope

At the time of review, the repository had one open pull request:

- #410 — `test: cover ServerHello cipher suite validation`

## Review completed

Review comment: https://github.com/UnsafeLabs/Bounty-Hunters/pull/410#pullrequestreview-4285410877

## Local verification

Checked out PR #410 locally and ran:

```bash
node javascript/tls_handshake_client.test.js
```

Result:

```text
tls_handshake_client tests passed
```

## Summary of feedback

The PR is focused and useful: it adds regression coverage for a ServerHello
selecting a cipher suite that the client did not offer, checks TLS alert `47`,
and confirms the negotiated cipher suite is not set after rejection.

Non-blocking improvement suggested: also assert `negotiatedHash === null` in the
rejection path so both negotiation state fields are covered.

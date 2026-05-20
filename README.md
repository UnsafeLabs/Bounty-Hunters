# Bounty-Hunters

A curated collection of cross-language TLS implementations and security-focused programming exercises. This repository serves as both a learning resource for TLS protocol internals and a platform for bounty-based contributions.

## Project Overview

This repository contains TLS-related implementations in multiple programming languages:

- **Python** — TLS 1.2 handshake state machine with message parsing, extension negotiation, and key derivation
- **JavaScript** — TLS 1.3 client handshake implementation with ECDH key exchange and certificate verification
- **C** — TLS certificate chain validator using OpenSSL with OCSP support and fingerprint pinning
- **Rust** — TLS session cache and ticket management with encryption

Each implementation is self-contained and designed for educational purposes, demonstrating real-world protocol patterns.

## Folder Structure

```
c/                  C implementations (OpenSSL-based)
├── tls_cert_validator.c    TLS certificate chain validator

javascript/         JavaScript/Node.js implementations
├── tls_handshake_client.js TLS 1.3 handshake client

python/             Python implementations
├── tls_handshake.py        TLS 1.2 handshake state machine

rust/               Rust implementations
├── tls_session.rs          TLS session cache and ticket management

fastapi/            FastAPI web framework fork (community contributions)
laravel/            Laravel PHP framework fork (community contributions)
t3code/             T3 Code application (TypeScript Effect-based stack)
```

## How the Bounty System Works

Bounties are labeled with `💎 Bounty` and contain a dollar amount in the issue body. Each bounty targets a specific improvement:

| Label | Description |
|-------|-------------|
| `💎 Bounty $1` | Simple tasks: documentation, tests, minor fixes |
| `💎 Bounty $10-50` | Moderate effort: feature additions, configuration |
| `💎 Bounty $100+` | Complex features requiring deeper implementation |

### Claiming a Bounty

1. Find an open issue with the `💎 Bounty` label and no assignee
2. Fork the repository and create a branch named `fix/{description}-{issue-number}`
3. Implement the fix following existing code conventions
4. Open a pull request with the format:
   - Title: `Gaotax2006 [ Category ] Fix #N: description`
   - Body: `Fixes #N` followed by description, files changed, and checklist
5. PRs are reviewed and merged by maintainers

### Rules

- Do not modify `CONTRIBUTORS.json`
- Do not include AI training leakage markers
- Do not commit build artifacts
- Match existing code style — do not reformat unrelated code

## How to Contribute

1. Fork the repo and create a feature branch from `main`
2. Make focused changes — only touch files relevant to the issue
3. Follow the existing code style and conventions of each language directory
4. Submit a PR with a clear description of the change
5. For TLS-specific changes, ensure protocol correctness per relevant RFCs

## License

This project is licensed under the MIT License.

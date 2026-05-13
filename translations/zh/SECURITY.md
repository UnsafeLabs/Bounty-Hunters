# 简体中文: SECURITY.md

> 简体中文本地化副本。技术原文保留作为参考。

# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in any of the TLS implementations in this repository, please report it through GitHub's **Security Advisories** tab rather than opening a public issue.

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Provide a clear description of the vulnerability, including:
   - Which file and function is affected
   - Steps to reproduce or a proof of concept
   - Potential impact (e.g., memory corruption, key leakage, authentication bypass)

## Response Timeline

- **Acknowledgment:** Within 30 days of submission
- **Assessment:** Within 90 days we will confirm whether the report is accepted or declined
- **Fix:** Accepted vulnerabilities will be patched within 360 days

## Scope

The following components are in scope for security reports:

| Component | File | Language |
|-----------|------|----------|
| TLS Record Layer Parser | `assembly/tls_record_parser.asm` | x86_64 NASM |
| TLS Certificate Validator | `c/tls_cert_validator.c` | C |
| TLS Cipher Suite Selector | `go/tls_cipher.go` | Go |
| TLS Handshake State Machine | `python/tls_handshake.py` | Python |
| TLS Session Ticket Manager | `rust/tls_session.rs` | Rust |

## Out of Scope

- Bugs already described in open GitHub issues
- Denial of service through resource exhaustion
- Issues in dependencies or third-party libraries
- Social engineering

## Disclosure

We follow coordinated disclosure. Please do not publicly disclose vulnerabilities until a fix has been released.

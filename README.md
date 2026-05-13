# Bounty-Hunters

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Open issues](https://img.shields.io/github/issues/UnsafeLabs/Bounty-Hunters)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

Bounty-Hunters is a compact, multi-language security training repository.
It collects small TLS-focused examples that are useful for code review,
bug hunting, secure coding practice, and bounty-style contribution drills.
Each source folder contains one focused implementation with intentionally
interesting control flow, parsing, or validation behavior.

The repository is intentionally small. That makes it practical for new
contributors to inspect the full codebase, select one GitHub issue, and
submit a narrowly scoped pull request that can be reviewed quickly.

## Project Overview

This project is organized around TLS implementation exercises. The examples
cover record parsing, certificate validation, handshake processing, cipher
suite selection, session ticket handling, operational scripts, configuration
files, and documentation.

The goal is not to provide a production TLS library. The code is better read
as a review target: each file demonstrates patterns that security-minded
contributors can inspect, test, document, or harden through individual issues.

Typical work in this repository includes:

- fixing one vulnerable or fragile code path
- adding tests for a specific function or component
- improving documentation for an existing module
- correcting shell script safety problems
- updating examples while preserving the repository structure
- keeping each pull request tied to exactly one issue

## Repository Layout

| Folder | Description |
| --- | --- |
| [assembly/](assembly/) | x86_64 NASM TLS record layer parser that reads record headers and dispatches by content type. |
| [c/](c/) | C certificate chain validator using OpenSSL types, chain checks, fingerprint pinning, and trust store helpers. |
| [rust/](rust/) | Rust session ticket cache and placeholder ticket encryption helpers for TLS session resumption exercises. |
| [python/](python/) | Python TLS 1.2 handshake state machine with record parsing, extension parsing, and key derivation helpers. |
| [go/](go/) | Go cipher suite registry that negotiates, filters, sorts, and formats TLS cipher suite metadata. |
| [english/](english/) | Writing samples and text exercises used by documentation and repository-content bounties. |
| [docs/](docs/) | Project documentation, setup notes, API reference material, and changelog content. |
| [config/](config/) | Example app, Docker Compose, and Nginx configuration files for configuration-review tasks. |
| [scripts/](scripts/) | Shell scripts for backup, cleanup, and deployment safety exercises. |

## Top-Level Files

- [CONTRIBUTING.md](CONTRIBUTING.md) explains contribution rules, bounty flow, PR expectations, and review timing.
- [SECURITY.md](SECURITY.md) describes how security-related concerns should be handled.
- [LICENSE](LICENSE) contains the project license text.
- [clankers.md](clankers.md) tracks contributor or repository metadata used by project automation.

## Getting Started

Clone the repository and enter the workspace:

```bash
git clone https://github.com/UnsafeLabs/Bounty-Hunters.git
cd Bounty-Hunters
```

Review the contribution rules before starting:

```bash
less CONTRIBUTING.md
```

Pick exactly one open issue, comment to claim it, and keep your pull request
limited to the files needed for that issue.

## Prerequisites

The repository does not require one universal build system. Install the tools
for the language or folder you plan to work on.

### Assembly

Install NASM and a system linker:

```bash
sudo apt-get update
sudo apt-get install -y nasm binutils
```

On macOS:

```bash
brew install nasm
```

### C

Install a C compiler and OpenSSL development headers:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libssl-dev
```

On macOS:

```bash
brew install openssl
```

### Rust

Install Rust with rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version
```

### Python

Use Python 3:

```bash
python3 --version
```

Optional test tooling:

```bash
python3 -m pip install pytest
```

### Go

Install Go:

```bash
go version
```

If you are running the standalone file without a module, use GOPATH mode:

```bash
cd go
GO111MODULE=off go test .
```

## Run And Test Commands

Use the smallest relevant command for the file you changed. The examples below
are intentionally simple because the repository is source-file oriented.

### Python

Compile-check the TLS handshake module:

```bash
python3 -m py_compile python/tls_handshake.py
```

Run pytest when a Python test file is present:

```bash
python3 -m pytest python/
```

### Go

Run tests for the Go package:

```bash
cd go
GO111MODULE=off go test .
```

Format Go files before submitting:

```bash
gofmt -w tls_cipher.go
```

### Rust

Compile the Rust source as a library:

```bash
rustc --crate-type lib rust/tls_session.rs -o /tmp/tls_session.rlib
```

If a future issue adds a Cargo manifest, prefer:

```bash
cargo test
```

### C

Compile the certificate validator with OpenSSL:

```bash
gcc -Wall -Wextra -I/usr/include c/tls_cert_validator.c -lssl -lcrypto -o /tmp/tls_cert_validator
```

If your OpenSSL headers are installed in a custom prefix, add the matching
`-I` and `-L` flags for your platform.

### Assembly

Assemble the record parser with NASM:

```bash
nasm -f elf64 assembly/tls_record_parser.asm -o /tmp/tls_record_parser.o
ld /tmp/tls_record_parser.o -o /tmp/tls_record_parser
```

### Shell Scripts

Syntax-check the operational scripts:

```bash
bash -n scripts/backup.sh
bash -n scripts/cleanup.sh
bash -n scripts/deploy.sh
```

## Bounty Workflow

The bounty process is issue driven.

1. Open the GitHub issue list and choose one issue.
2. Read the issue description and all acceptance criteria.
3. Comment on the issue before starting so other contributors know it is claimed.
4. Create a branch for that single issue.
5. Change only the files needed to satisfy that issue.
6. Add or update tests when the issue asks for test coverage.
7. Run the relevant commands from this README.
8. Open a pull request that closes the issue.

Bounties are paid after the pull request is merged into `main`. The amount is
shown by the issue label, such as `$1`, and by any bounty note in the issue
body. See [CONTRIBUTING.md](CONTRIBUTING.md) for the exact review rules.

## Pull Request Checklist

Before opening a pull request, confirm:

- the PR addresses exactly one issue
- the title and body mention the issue number
- all acceptance criteria from the issue are copied into the PR body
- each completed criterion is checked off
- the changed files are limited to the issue scope
- no unrelated formatting or refactoring is included
- relevant commands have been run locally
- the PR links to [CONTRIBUTING.md](CONTRIBUTING.md) rules by following them

## Contribution Guidelines

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting. The most important
rule is one issue per pull request. This keeps review fast and prevents one
large change from blocking several unrelated bounty fixes.

Use conventional commit messages when possible:

```text
fix(python): reject invalid handshake transition
docs(readme): expand repository setup guide
test(go): cover cipher suite filtering
```

Keep descriptions factual. Explain what changed, why it changed, and which
checks passed.

## Security Notes

This repository contains security-themed examples and may include intentionally
weak or incomplete code paths for training. Do not reuse these source files as
production TLS components. If you believe you found a sensitive issue outside
the scope of a public bounty, follow [SECURITY.md](SECURITY.md).

When working on security fixes:

- do not publish secrets, private keys, tokens, or live service credentials
- avoid testing against systems you do not own or have permission to test
- prefer local fixtures and deterministic test inputs
- document proof with commands and expected outputs
- keep public reports focused on source code and reproducible behavior

## Documentation Map

The [docs/](docs/) directory contains supporting material:

- [docs/api-reference.md](docs/api-reference.md) for API-oriented notes
- [docs/setup-guide.md](docs/setup-guide.md) for setup details
- [docs/changelog.md](docs/changelog.md) for repository history

The [english/](english/) directory contains text files used by writing-related
issues:

- [english/acrostics.md](english/acrostics.md)
- [english/haikus.md](english/haikus.md)
- [english/limericks.md](english/limericks.md)
- [english/songs.md](english/songs.md)
- [english/sonnets.md](english/sonnets.md)

## Configuration Files

Configuration examples live in [config/](config/):

- [config/app.json](config/app.json)
- [config/docker-compose.yml](config/docker-compose.yml)
- [config/nginx.conf](config/nginx.conf)

Review these files carefully when working on configuration-security issues.
Small defaults, unsafe paths, or permissive service settings can be meaningful
in a security training repository.

## Scripts

Operational scripts live in [scripts/](scripts/):

- [scripts/backup.sh](scripts/backup.sh)
- [scripts/cleanup.sh](scripts/cleanup.sh)
- [scripts/deploy.sh](scripts/deploy.sh)

Shell issues should usually include `bash -n` validation and a short note about
the safety property being protected.

## License

This project is licensed under the terms in [LICENSE](LICENSE).

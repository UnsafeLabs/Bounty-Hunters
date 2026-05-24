# Bounty-Hunters

![License](LICENSE)
![GitHub issues](https://img.shields.io/github/issues/UnsafeLabs/Bounty-Hunters)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

A multi-language TLS security toolkit and bounty playground. This repository contains TLS protocol implementations, security analysis tools, and creative English content — all organized by language with individual source files.

## Project Overview

Bounty-Hunters is an educational research project that implements TLS protocol components across multiple programming languages. Each directory contains self-contained source files related to TLS security, including certificate validation, handshake state machines, cipher suite selection, session management, and more.

The repository is structured as a bounty platform where contributors can pick issues, implement fixes, and earn bounties. It covers a wide range of languages and difficulty levels, making it suitable for contributors of all skill levels.

### Repository Structure

| Directory | Description | Source File |
|-----------|-------------|-------------|
| `assembly/` | x86_64 NASM — TLS record layer parser | [`tls_record_parser.asm`](assembly/tls_record_parser.asm) |
| `c/` | C — TLS certificate chain validator | [`tls_cert_validator.c`](c/tls_cert_validator.c) |
| `go/` | Go — TLS cipher suite selector | [`tls_cipher.go`](go/tls_cipher.go) |
| `python/` | Python — TLS handshake state machine | [`tls_handshake.py`](python/tls_handshake.py) |
| `rust/` | Rust — TLS session ticket manager | [`tls_session.rs`](rust/tls_session.rs) |
| `english/` | English — Creative writing and poetry | [`sonnets.md`](english/sonnets.md), [`haikus.md`](english/haikus.md), [`limericks.md`](english/limericks.md), [`songs.md`](english/songs.md), [`acrostics.md`](english/acrostics.md) |
| `docs/` | Documentation and guides | [`api-reference.md`](docs/api-reference.md), [`setup-guide.md`](docs/setup-guide.md), [`changelog.md`](docs/changelog.md) |
| `config/` | Configuration files | [`app.json`](config/app.json), [`docker-compose.yml`](config/docker-compose.yml), [`nginx.conf`](config/nginx.conf) |
| `scripts/` | Shell scripts for automation | [`backup.sh`](scripts/backup.sh), [`cleanup.sh`](scripts/cleanup.sh), [`deploy.sh`](scripts/deploy.sh) |

### Additional Directories

Additional language directories exist beyond the core nine: `cobol/`, `solidity/`, `javascript/`, `fastapi/`, `laravel/`, and `t3code/`. These contain their own source files with separate bounties.

## Getting Started

### Prerequisites

Each language directory requires its own toolchain. Install the required tools for the language you want to work with:

#### Assembly (NASM)

```bash
# Ubuntu/Debian
sudo apt-get install nasm
# macOS
brew install nasm
# Verify
nasm --version
```

#### C (GCC)

```bash
# Ubuntu/Debian
sudo apt-get install gcc
# macOS
xcode-select --install
# Verify
gcc --version
```

#### Rust (rustc)

```bash
# Install rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Verify
rustc --version
cargo --version
```

#### Python

```bash
# Ubuntu/Debian
sudo apt-get install python3 python3-pip
# macOS
brew install python3
# Verify
python3 --version
pip3 --version
```

#### Go

```bash
# Ubuntu/Debian
sudo apt-get install golang
# macOS
brew install go
# Verify
go version
```

#### Testing with Docker

A [`docker-compose.yml`](config/docker-compose.yml) file is provided for running the full stack locally:

```bash
docker-compose up -d
```

### Clone the Repository

```bash
git clone https://github.com/UnsafeLabs/Bounty-Hunters.git
cd Bounty-Hunters
```

## How the Bounty System Works

Bounties are listed as GitHub issues with the `💎 Bounty` label. Each issue includes acceptance criteria, a dollar amount in the body, and language-specific requirements.

1. **Find an issue** labeled `💎 Bounty` that is unassigned
2. **Read the issue** to understand the acceptance criteria
3. **Claim the issue** by commenting on it
4. **Implement the fix** following the language-specific conventions
5. **Submit a PR** referencing the issue number
6. **Receive a bounty** upon merge

Bounty amounts vary by complexity. $1 issues are entry-level, while higher amounts indicate more complex tasks.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on:

- Bounty program rules
- One issue per pull request policy
- Commit message conventions
- Test requirements
- Code style guidelines
- Review process

All contributions are welcome — from first-time contributors to experienced developers.

## Language-Specific Conventions

### Assembly (assembly/)

- Source files use NASM syntax for x86_64
- Comments should explain register usage and calling conventions

### C (c/)

- Follow C99 standard
- Use `const` for read-only parameters
- Check return values from all memory and crypto operations

### Go (go/)

- Follow standard `gofmt` formatting
- Use goroutines only when necessary for concurrency
- Prefer explicit error returns over panics

### Python (python/)

- Follow PEP 8 style guidelines
- Use type hints for function signatures
- Prefer `hmac.compare_digest` for timing-safe comparisons

### Rust (rust/)

- Follow standard `rustfmt` formatting
- Use `Result` for fallible operations
- Avoid `unwrap()` in production code

## Project Status

This project is actively maintained with regular new bounties. Issues are added periodically across all language directories. Check the [issues page](https://github.com/UnsafeLabs/Bounty-Hunters/issues) for the latest available bounties.

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file.

## Security

For security concerns, see [SECURITY.md](SECURITY.md).

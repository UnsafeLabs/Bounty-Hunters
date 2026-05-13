# Bounty-Hunters

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open Issues](https://img.shields.io/github/issues/UnsafeLabs/Bounty-Hunters.svg)](https://github.com/UnsafeLabs/Bounty-Hunters/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/UnsafeLabs/Bounty-Hunters/blob/main/CONTRIBUTING.md)

## Project Overview

Bounty-Hunters is an open-source security research and vulnerability collection project by [UnsafeLabs](https://unsafelabs.com). The repository centralizes security-related code samples, vulnerability detection patterns, proof-of-concept implementations, and security tooling across multiple programming languages. It serves as an educational resource for security researchers, bug bounty hunters, and developers looking to understand common vulnerabilities and how they manifest in different languages.

## Folder Structure

| Directory      | Description |
|----------------|-------------|
| `assembly/`    | Low-level exploit payloads, shellcode, and TLS record parsing examples in x86/x64 assembly |
| `c/`           | C language vulnerability exploits, TLS certificate validation issues, and memory corruption patterns |
| `rust/`        | Rust-based security tools focusing on safe TLS session handling and memory-safe exploitation patterns |
| `python/`      | Python scripts for TLS handshake analysis, vulnerability scanning, and security PoC implementations |
| `go/`          | Go network security tools, including TLS cipher analysis and vulnerability detection utilities |
| `english/`     | Creative security documentation written as haikus, sonnets, acrostics, songs, and limericks |
| `docs/`        | Structured documentation including setup guides, API references, and changelogs |
| `config/`      | Configuration files for containerized deployments (docker-compose.yaml), Nginx, and application settings |
| `scripts/`     | Shell scripts for deployment, backup, and log cleanup with security best practices |

## Getting Started

### Prerequisites

| Language   | Required Tools | Install Command |
|------------|----------------|-----------------|
| Assembly   | `nasm` (Netwide Assembler), `ld` (Linker) | `sudo apt install nasm binutils` |
| C          | `gcc` or `clang` | `sudo apt install build-essential` |
| Rust       | `rustc` and `cargo` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| Python     | `python3` (3.8+) and `pip` | `sudo apt install python3 python3-pip` |
| Go         | `go` (1.20+) | `sudo apt install golang-go` |
| Shell      | `bash` (4.2+), `tar`, `gzip` | Pre-installed on most Linux/macOS systems |

### Quick Start

```bash
# Clone the repository
git clone https://github.com/UnsafeLabs/Bounty-Hunters.git
cd Bounty-Hunters

# Explore by language
ls assembly/    # TLS record parser in assembly
ls c/           # TLS certificate validator
ls rust/        # TLS session handler in Rust
ls python/      # TLS handshake analyzer
ls go/          # TLS cipher analysis tool
ls scripts/     # Deployment and backup scripts
ls config/      # Docker and Nginx configurations

# Run Python security scanner
cd python/
python3 tls_handshake.py

# Build Go security tool
cd go/
go build tls_cipher.go
```

## Running & Testing

### Assembly

```bash
cd assembly/
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
./tls_record_parser
```

### C

```bash
cd c/
gcc tls_cert_validator.c -o tls_cert_validator -lssl -lcrypto
./tls_cert_validator
```

### Rust

```bash
cd rust/
rustc tls_session.rs -o tls_session
./tls_session
```

### Python

```bash
cd python/
pip install -r requirements.txt 2>/dev/null || true
python3 tls_handshake.py
```

### Go

```bash
cd go/
go build tls_cipher.go
./tls_cipher
```

### Containerized Environment

```bash
cd config/
docker-compose up -d
```

## How the Bounty System Works

Select issues in this repository carry monetary rewards, managed through [Algora](https://algora.io). Here is how to participate:

1. **Browse bounties**: Visit the [Issues](https://github.com/UnsafeLabs/Bounty-Hunters/issues) tab and look for issues with the `💎 Bounty` label.
2. **Start working**: Comment `/attempt #<issue-number>` on the issue with your plan of action.
3. **Submit your work**: Create a pull request and include `/claim #<issue-number>` in the PR body.
4. **Receive payment**: Once your PR is reviewed, approved, and merged, the bounty reward is automatically distributed to you via Algora.

Payment is typically processed within minutes of merging. All bounties are denominated in USD and paid via Algora.

### Current Active Bounties

| Issue | Description | Reward |
|-------|-------------|--------|
| [#328](https://github.com/UnsafeLabs/Bounty-Hunters/issues/328) | Write comprehensive README.md | $150 |
| [#319](https://github.com/UnsafeLabs/Bounty-Hunters/issues/319) | Fix string vs arithmetic comparison in cleanup.sh | $36 |
| [#317](https://github.com/UnsafeLabs/Bounty-Hunters/issues/317) | Fix dangerous rm -rf with unset variable guard in deploy.sh | $33 |
| [#315](https://github.com/UnsafeLabs/Bounty-Hunters/issues/315) | Fix unquoted variable in backup.sh | $26 |
| [#312](https://github.com/UnsafeLabs/Bounty-Hunters/issues/312) | Fix port mapping in docker-compose.yml | — |
| [#311](https://github.com/UnsafeLabs/Bounty-Hunters/issues/311) | Fix missing semicolon in nginx.conf | — |
| [#310](https://github.com/UnsafeLabs/Bounty-Hunters/issues/310) | Fix image tag typo in docker-compose.yml | — |
| [#309](https://github.com/UnsafeLabs/Bounty-Hunters/issues/309) | Fix misspelled database key in app.json | $10 |
| [#308](https://github.com/UnsafeLabs/Bounty-Hunters/issues/308) | Fix trailing comma in app.json | — |
| [#307](https://github.com/UnsafeLabs/Bounty-Hunters/issues/307) | Fix date ordering in changelog.md | — |

## Contributing

We welcome contributions in all forms — bug fixes, new security tools, documentation, or creative writing in the `english/` directory.

- Read our [Contributing Guide](CONTRIBUTING.md) for detailed guidelines.
- Follow our [Security Policy](SECURITY.md) for reporting vulnerabilities.
- Review our [Code of Conduct](CODE_OF_CONDUCT.md) for community standards.

### Contribution Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and test them
4. Commit with a descriptive message: `git commit -m "fix: resolve issue #X"`
5. Push to your fork: `git push origin my-feature`
6. Open a pull request referencing the relevant issue

## Security

If you discover a security vulnerability within this project, please do not open a public issue. Instead, refer to our [Security Policy](SECURITY.md) and report it responsibly.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [UnsafeLabs](https://unsafelabs.com) for security research infrastructure and support.
- The bug bounty and security research community for continuous contributions.
- All contributors who've improved the security tools and documentation in this repository.

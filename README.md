# Bounty-Hunters

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open Issues](https://img.shields.io/github/issues/UnsafeLabs/Bounty-Hunters.svg)](https://github.com/UnsafeLabs/Bounty-Hunters/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/UnsafeLabs/Bounty-Hunters/blob/main/CONTRIBUTING.md)

## Project Overview

Bounty-Hunters is an open-source security research project by UnsafeLabs. The repository serves as a centralized resource for security researchers, bug bounty hunters, and developers. It contains vulnerability detection patterns, proof-of-concept implementations, and security tooling across multiple programming languages.

## Folder Structure

| Directory      | Description |
|----------------|-------------|
| `assembly/`    | Low-level exploit payloads, shellcode, and TLS record parsing in x86/x64 assembly |
| `c/`           | C language vulnerability exploits and memory corruption examples |
| `rust/`        | Safe exploitation patterns and security testing in Rust |
| `python/`      | Python security scripts, scanners, and PoC exploit tools |
| `go/`          | Go network security tools and vulnerability detection |
| `english/`     | Security documentation written as creative works (haikus, sonnets, songs) |
| `docs/`        | Setup guides, API references, and changelogs |
| `config/`      | Containerized deployment configs (Docker, Nginx, app settings) |
| `scripts/`     | Shell scripts for deployment, backup, and log cleanup |

## Getting Started

### Prerequisites

| Language   | Required Tools | Install Command |
|------------|----------------|-----------------|
| Assembly   | `nasm`, `ld` | `sudo apt install nasm binutils` |
| C          | `gcc` or `clang` | `sudo apt install build-essential` |
| Rust       | `rustc` and `cargo` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| Python     | `python3` (3.8+) | `sudo apt install python3 python3-pip` |
| Go         | `go` (1.20+) | `sudo apt install golang-go` |
| Shell      | `bash` (4.2+) | Pre-installed on Linux/macOS |

### Quick Start

\`\`\`bash
# Clone the repository
git clone https://github.com/UnsafeLabs/Bounty-Hunters.git
cd Bounty-Hunters

# Explore by language
ls assembly/    # TLS record parser in assembly
ls c/           # TLS certificate validator
ls python/      # TLS handshake analyzer
\`\`\`

### Running and Testing by Language

**Assembly:**
\`\`\`bash
cd assembly/
nasm -f elf64 tls_record_parser.asm -o tls_record_parser.o
ld tls_record_parser.o -o tls_record_parser
./tls_record_parser
\`\`\`

**C:**
\`\`\`bash
cd c/
gcc tls_cert_validator.c -o tls_cert_validator -lssl -lcrypto
./tls_cert_validator
\`\`\`

**Rust:**
\`\`\`bash
cd rust/
rustc tls_session.rs -o tls_session
./tls_session
\`\`\`

**Python:**
\`\`\`bash
cd python/
python3 tls_handshake.py
\`\`\`

**Go:**
\`\`\`bash
cd go/
go build tls_cipher.go
./tls_cipher
\`\`\`

**Containerized:**
\`\`\`bash
cd config/
docker-compose up -d
\`\`\`

## How the Bounty System Works

Select issues in this repository carry monetary rewards through [Algora](https://algora.io):

1. **Browse bounties**: Visit [Issues](https://github.com/UnsafeLabs/Bounty-Hunters/issues) and look for the Bounty label.
2. **Start working**: Comment `/attempt #<issue-number>` with your plan.
3. **Submit work**: Create a pull request with `/claim #<issue-number>` in the PR body.
4. **Receive payment**: Once merged, the bounty is automatically distributed via Algora.

Payment is processed within minutes of merging. All bounties are denominated in USD.

## Contributing

We welcome contributions in all forms. See our [Contributing Guide](CONTRIBUTING.md) for details.

### Workflow

1. Fork it
2. Create a feature branch: `git checkout -b my-feature`
3. Make your changes and test them
4. Commit: `git commit -m "fix: resolve issue #X"`
5. Push and open a pull request

## Security

Please see [Security Policy](SECURITY.md) for responsible disclosure.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [UnsafeLabs](https://unsafelabs.com) for security research support.
- The security research community for continuous contributions.

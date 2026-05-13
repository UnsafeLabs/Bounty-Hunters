# 简体中文: CONTRIBUTING.md

> 简体中文本地化副本。技术原文保留作为参考。

# Contributing Guidelines

Thank you for your interest in contributing to this project. Please read this guide carefully before submitting any pull requests.

## Bounty Program

Each GitHub issue describes a bug or feature request with a bounty label (e.g., `$1`). Bounty amounts vary by issue complexity. Bounties are paid upon merge.

## Rules

### One Issue Per Pull Request

Each pull request must address **exactly one** GitHub issue. Do not combine fixes for multiple issues into a single PR. PRs that touch more than one issue will be closed without review.

**Good:** A PR titled "Fix check_expiry() integer overflow" that addresses only issue #7.

**Bad:** A PR that fixes both issue #7 and issue #12 in one submission.

### Claim Before You Start

Comment on the GitHub issue you want to work on before starting. This prevents duplicate effort. Unclaimed PRs will be deprioritized. Claims expire after **48 hours** of inactivity.


### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
fix(c): use constant-time comparison in match_fingerprint

Replaces memcmp() with CRYPTO_memcmp() to prevent timing
side-channel attacks on certificate fingerprint validation.

Closes #<issue-number>
```

### Code Changes Only

Your PR should contain **only** the code changes required to satisfy the acceptance criteria listed in the GitHub issue. Do not:

- Refactor surrounding code
- Update documentation or comments unrelated to the fix
- Rename variables or reformat files
- Add dependencies unless absolutely required by the fix
- Modify source files outside the target language folder

### Tests Are Required

Every PR must include tests that cover the fix or feature. The acceptance criteria in each issue list the exact conditions your tests should verify. PRs without tests will not be merged.

### Match the Language and Style

Write code that matches the existing style of the file you are modifying. Do not introduce new formatting conventions, linting rules, or structural patterns.

## Pull Request Template

Your PR description must include:

1. **Issue:** Which issue this addresses (e.g., `Closes #14`)
2. **Summary:** One or two sentences describing what you changed
3. **Acceptance criteria checklist:** Copy the acceptance criteria from the issue and check each one off

Example:

```markdown
## Issue
Closes #14

## Summary
Generate a fresh random nonce for each call to encrypt_ticket() instead
of reusing the hardcoded ENCRYPTION_NONCE constant.

## Acceptance criteria
- [x] encrypt_ticket() generates a unique 12-byte nonce per call
- [x] Two consecutive encryptions of the same ticket produce different ciphertext
- [x] All existing tests still pass
- [x] Add new tests covering the fixed bugs
```

## Review Process

1. PRs are reviewed in the order they are received
2. You may receive feedback requesting changes — please respond within **48 hours** or the PR will be closed
3. Only PRs that satisfy **all** acceptance criteria will be merged
4. Bounty is paid after the PR is merged into `main`

## Folder Structure

```
assembly/    x86_64 NASM — TLS record layer parser
c/           C — TLS certificate chain validator
go/          Go — TLS cipher suite selector
python/      Python — TLS handshake state machine
rust/        Rust — TLS session ticket manager
```

Each folder contains one source file related to TLS protocol implementation.

## Code of Conduct

Be respectful. Spam PRs, low-effort submissions, or attempts to game the bounty system will result in a ban.

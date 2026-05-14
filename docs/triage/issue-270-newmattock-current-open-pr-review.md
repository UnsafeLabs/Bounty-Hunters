# Issue 270 current open PR triage

This report records a fresh review pass for issue 270.

## Scope

Snapshot time: 2026-05-14 01:15 UTC.

The repository had 18 open pull requests at review time: PR 410, PR 412, and
PR 414 through PR 429. Each open PR received one GitHub PR review from
`@newmattock`.

## Review method

- Listed all open PRs with `gh pr list`.
- Read the linked issue acceptance criteria for each PR.
- Inspected each PR diff with `gh pr diff`.
- Left one professional review comment on every open PR.
- Verified every open PR had one `@newmattock` review after posting.

## Findings

| PR | Linked issue | Review summary |
| --- | --- | --- |
| PR 410 | issue 391 | The ServerHello cipher-suite regression test covers alert 47 before `negotiatedCipherSuite` is assigned. Suggested also asserting `negotiatedHash` remains `null` after rejection. |
| PR 412 | issue 270 | The existing triage report was scoped to an earlier one-PR snapshot. Flagged that issue 270 now requires coverage for the full current open PR set. |
| PR 414 | issue 303 | The rate-limit table row is fixed and scoped correctly. Flagged duplicate overlap with PR 429 so maintainers can choose one issue 303 fix. |
| PR 415 | issue 304 | The Create Bounty endpoint is changed from GET to POST while preserving the path. Suggested documenting that only the method changed. |
| PR 416 | issue 305 | The new Step 4 section and `cp .env.example .env` command are present. Flagged the missing renumbering of later steps to 6, 7, and 8. |
| PR 417 | issue 306 | The package install command is corrected inside the existing Step 3 code block. Suggested making the narrow docs scope explicit in validation. |
| PR 418 | issue 307 | The changelog version blocks are reordered correctly. Suggested noting that the entry text was moved without content edits. |
| PR 419 | issue 310 | The Docker image tag suffix is corrected and the claim directive for issue 310 is present. Flagged duplicate overlap with PR 428. |
| PR 420 | issue 311 | The missing nginx semicolon is added in scope. Suggested adding an nginx syntax validation command or result. |
| PR 421 | issue 312 | The API port mapping is changed to `8080:8080` while `9090:9090` remains unchanged. Suggested documenting that narrow validation. |
| PR 422 | issue 315 | The target `$BACKUP_DIR` check is quoted. Flagged extra backup-script changes outside the linked issue's "all other content unchanged" criterion. |
| PR 423 | issue 316 | `set -e` is added immediately after the shebang. Suggested adding `bash -n scripts/deploy.sh` or equivalent validation. |
| PR 424 | issue 389 | `supported_versions` is serialized after `key_share` and the test checks TLS 1.3 `0x0304`. Suggested checking the extension appears exactly once. |
| PR 425 | issue 390 | The HKDF label tests cover the single-prefix boundary. Flagged that the issue also asks for RFC 8446 test vectors, which are not present as fixed vector fixtures. |
| PR 426 | issue 393 | Finished hash length is tested for SHA-384 and SHA-256, with a guard against numeric `negotiatedHash`. Suggested covering all advertised suites or the ChaCha20 SHA-256 suite. |
| PR 427 | issue 392 | Validity-period tests cover leaf and non-leaf expiry with alert code 45. Suggested adding a not-yet-valid intermediate/root certificate case. |
| PR 428 | issue 310 | The Docker image tag suffix is corrected in scope. Suggested adding the claim directive for issue 310 if the author intends to claim the bounty. |
| PR 429 | issue 303 | The missing table-row pipe is fixed in scope. Suggested adding the claim directive for issue 303 if the author intends to claim the bounty. |

## Verification

Post-review verification confirmed each open PR had one review from
`@newmattock`:

```text
PR 429: 1
PR 428: 1
PR 427: 1
PR 426: 1
PR 425: 1
PR 424: 1
PR 423: 1
PR 422: 1
PR 421: 1
PR 420: 1
PR 419: 1
PR 418: 1
PR 417: 1
PR 416: 1
PR 415: 1
PR 414: 1
PR 412: 1
PR 410: 1
```

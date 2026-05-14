# Issue 270 current open PR triage

This report records a fresh review pass for issue #270.

## Scope

Snapshot time: 2026-05-14 01:15 UTC.

The repository had 18 open pull requests at review time: #410, #412, and
#414 through #429. Each open PR received one GitHub PR review from
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
| #410 | #391 | The ServerHello cipher-suite regression test covers alert 47 before `negotiatedCipherSuite` is assigned. Suggested also asserting `negotiatedHash` remains `null` after rejection. |
| #412 | #270 | The existing triage report was scoped to an earlier one-PR snapshot. Flagged that issue #270 now requires coverage for the full current open PR set. |
| #414 | #303 | The rate-limit table row is fixed and scoped correctly. Flagged duplicate overlap with #429 so maintainers can choose one #303 fix. |
| #415 | #304 | The Create Bounty endpoint is changed from GET to POST while preserving the path. Suggested documenting that only the method changed. |
| #416 | #305 | The new Step 4 section and `cp .env.example .env` command are present. Flagged the missing renumbering of later steps to 6, 7, and 8. |
| #417 | #306 | The package install command is corrected inside the existing Step 3 code block. Suggested making the narrow docs scope explicit in validation. |
| #418 | #307 | The changelog version blocks are reordered correctly. Suggested noting that the entry text was moved without content edits. |
| #419 | #310 | The Docker image tag suffix is corrected and `/claim #310` is present. Flagged duplicate overlap with #428. |
| #420 | #311 | The missing nginx semicolon is added in scope. Suggested adding an nginx syntax validation command or result. |
| #421 | #312 | The API port mapping is changed to `8080:8080` while `9090:9090` remains unchanged. Suggested documenting that narrow validation. |
| #422 | #315 | The target `$BACKUP_DIR` check is quoted. Flagged extra backup-script changes outside the linked issue's "all other content unchanged" criterion. |
| #423 | #316 | `set -e` is added immediately after the shebang. Suggested adding `bash -n scripts/deploy.sh` or equivalent validation. |
| #424 | #389 | `supported_versions` is serialized after `key_share` and the test checks TLS 1.3 `0x0304`. Suggested checking the extension appears exactly once. |
| #425 | #390 | The HKDF label tests cover the single-prefix boundary. Flagged that the issue also asks for RFC 8446 test vectors, which are not present as fixed vector fixtures. |
| #426 | #393 | Finished hash length is tested for SHA-384 and SHA-256, with a guard against numeric `negotiatedHash`. Suggested covering all advertised suites or the ChaCha20 SHA-256 suite. |
| #427 | #392 | Validity-period tests cover leaf and non-leaf expiry with alert code 45. Suggested adding a not-yet-valid intermediate/root certificate case. |
| #428 | #310 | The Docker image tag suffix is corrected in scope. Suggested adding `/claim #310` if the author intends to claim the bounty. |
| #429 | #303 | The missing table-row pipe is fixed in scope. Suggested adding `/claim #303` if the author intends to claim the bounty. |

## Verification

Post-review verification confirmed each open PR had one review from
`@newmattock`:

```text
#429 1
#428 1
#427 1
#426 1
#425 1
#424 1
#423 1
#422 1
#421 1
#420 1
#419 1
#418 1
#417 1
#416 1
#415 1
#414 1
#412 1
#410 1
```

# Open PR triage report for issue 270

Fresh triage pass completed on 2026-05-14.

## Scope reviewed

I reviewed every pull request that was open at the initial snapshot plus the pull requests that appeared during follow-up checks:

- PR 574, linked to issue 270
- PR 568, linked to issue 270
- PR 567, linked to issue 519
- PR 561, linked to issue 303
- PR 560, linked to issue 515
- PR 559, linked to issue 516
- PR 558, linked to issue 319
- PR 557, linked to issue 318
- PR 556, linked to issue 317
- PR 555, linked to issue 316
- PR 554, linked to issue 315
- PR 553, linked to issue 312
- PR 552, linked to issue 311

Each PR had a linked issue, so no issue-link request was needed.

## Review comments left

- PR 574: performed a self-check confirming this triage-report PR links issue 270, changes only the triage report, and documents reviewed PRs, findings, and verification commands; offered to move the file if maintainers prefer `docs/triage/`.
- PR 568: confirmed the triage report includes a snapshot, reviewed PR list, linked issues, changed files, and per-PR findings; suggested aligning the summary with the final 12-PR coverage.
- PR 567: confirmed the COBOL audit overflow fix covers expanded audit capacity, pointer and length checks, overflow handling, truncation markers, and 300-byte Subject DN regression coverage; suggested making the hostname sentinel evidence easier to find in the PR body.
- PR 561: confirmed the markdown table row fix is scoped and matches the table-rendering criteria; suggested making the unchanged-content criterion explicit in the PR body.
- PR 560: confirmed the COBOL fingerprint comparison change covers the same-width buffer, bytewise comparison, regression cases, and logging criteria; suggested documenting the full-length scan or exiting after mismatch.
- PR 559: confirmed the empty-chain validator path covers the guard, self-signed trust-anchor check, bounded loop, and regression coverage; suggested clarifying which verification depends on a local GnuCOBOL runtime.
- PR 558: confirmed the cleanup comparison now uses arithmetic context and keeps the diff minimal; suggested adding syntax-check evidence.
- PR 557: confirmed the cleanup script shebang is the first line and the diff is minimal; suggested adding direct script syntax validation.
- PR 556: confirmed the deploy deletion guard is present before artifact cleanup and the affected paths are quoted; suggested explaining the quote changes as in scope.
- PR 555: confirmed `set -e` is placed immediately after the deploy script shebang; suggested adding syntax-check evidence.
- PR 554: confirmed quoting improves backup path handling; flagged that the diff is broader than the narrow issue text and that PR metadata did not show the standard checks.
- PR 553: confirmed the API service port mapping is corrected while the other mapping remains unchanged; suggested adding compose-level validation if available.
- PR 552: confirmed the nginx semicolon fix is minimal and matches the syntax-error criteria; suggested adding `nginx -t` evidence or explaining tool unavailability.

## Verification notes

- Queried all open PRs with GitHub CLI before commenting.
- Compared each PR body, changed files, and linked issue acceptance criteria.
- Checked status metadata where available.
- Left one professional, actionable triage comment on each open PR.

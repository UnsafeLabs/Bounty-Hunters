# Issue 270 Open PR Triage

Snapshot time: 2026-05-14 15:23 UTC

Reviewer: @sypham98-prog

Issue: 270

## Scope

I reviewed every pull request that was open in `UnsafeLabs/Bounty-Hunters`
at the snapshot time.

Open pull requests reviewed:

- PR 561 - Fix broken rate limits table row
- PR 560 - Compare COBOL certificate fingerprints bytewise
- PR 559 - Harden empty certificate chain handling
- PR 558 - Use arithmetic context for cleanup comparison
- PR 557 - Add missing cleanup shebang
- PR 556 - Guard deploy directory before remove commands
- PR 555 - Add `set -e` to deploy script
- PR 554 - Quote backup directory references
- PR 553 - Fix api service port mapping
- PR 552 - Add missing nginx semicolon

## Review Summary

### PR 561

Linked issue: 303

Changed files:

- `docs/api-reference.md`

Findings:

- The missing leading table pipe is added for the claims endpoint row.
- The change is limited to the expected API reference file.
- I suggested adding rendered Markdown/table validation and the correct claim
  marker if the author is claiming the issue.

### PR 560

Linked issue: 515

Changed files:

- `cobol/TLS-CERT-VALIDATOR.cbl`
- `cobol/TLS-CERT-FINGERPRINT-REGRESSION.cbl`

Findings:

- The implementation uses bytewise `FUNCTION ORD` comparison and includes
  A-F, digit-only, and mismatch regression cases.
- The changed files stay inside the COBOL scope.
- I suggested adding GnuCOBOL syntax/runtime evidence and clarifying that the
  repo field `CS-FINGERPRINT` is the trust-store fingerprint field referenced
  by the issue text.

### PR 559

Linked issue: 516

Changed files:

- `cobol/TLS-CERT-VALIDATOR.cbl`
- `cobol/test_empty_chain_regression.sh`

Findings:

- The zero-length chain guard and self-signed validation path address the
  core empty-chain acceptance criteria.
- The PR adds regression coverage for the empty trust-store rejection path.
- I suggested adding positive trust-anchor coverage or an explicit explanation
  for that branch, plus a note about the IBM optimizer verification limit.

### PR 558

Linked issue: 319

Changed files:

- `scripts/cleanup.sh`

Findings:

- The comparison now uses shell arithmetic context.
- The diff is limited to the targeted cleanup script line.
- I suggested adding shell syntax/runtime validation and replacing the bounty
  marker with the issue claim marker.

### PR 557

Linked issue: 318

Changed files:

- `scripts/cleanup.sh`

Findings:

- The shebang is added as the first line.
- No unrelated files are modified.
- I suggested adding direct execution or syntax validation and replacing the
  bounty marker with the issue claim marker.

### PR 556

Linked issue: 317

Changed files:

- `scripts/deploy.sh`

Findings:

- The guard is placed before the destructive remove commands.
- The remove paths are quoted in the same deployment cleanup block.
- I suggested using an unset-safe variable expansion and adding validation for
  the empty `DEPLOY_DIR` path.

### PR 555

Linked issue: 316

Changed files:

- `scripts/deploy.sh`

Findings:

- `set -e` is added immediately after the shebang.
- The change is limited to the deploy script.
- I suggested adding syntax or failure-path validation and replacing the
  bounty marker with the issue claim marker.

### PR 554

Linked issue: 315

Changed files:

- `scripts/backup.sh`

Findings:

- The backup directory references are quoted across the check, directory
  creation, output path, find command, and glob parent path.
- The change stays within the backup script.
- I suggested adding validation with a `BACKUP_DIR` value containing spaces and
  replacing the bounty marker with the issue claim marker.

### PR 553

Linked issue: 312

Changed files:

- `config/docker-compose.yml`

Findings:

- The api service mapping is changed from `8080` to `8080:8080`.
- The other port mapping remains unchanged.
- I suggested adding Compose/YAML validation and replacing the bounty marker
  with the issue claim marker.

### PR 552

Linked issue: 311

Changed files:

- `config/nginx.conf`

Findings:

- The missing semicolon is added to the `X-Forwarded-For` proxy header line.
- The change stays inside the nginx config.
- I suggested adding nginx syntax validation and replacing the bounty marker
  with the issue claim marker.

## Verification

- Listed currently open pull requests for `UnsafeLabs/Bounty-Hunters`.
- Read each pull request body and changed-file list.
- Read each linked issue acceptance criteria.
- Read pull request diffs for all reviewed pull requests.
- Submitted a `COMMENT` review on each open pull request listed above.

## Post-Submission Follow-Up

After opening this report PR, the repository had two additional open pull
requests:

- PR 568 - This issue 270 triage report
- PR 567 - COBOL audit log overflow rework for issue 519

I submitted `COMMENT` reviews for both of those pull requests as well, so all
12 pull requests open at the follow-up check had a review comment from this
issue 270 task.

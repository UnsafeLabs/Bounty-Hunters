# Issue 270 Open PR Triage

Snapshot time: 2026-05-14 08:55 UTC

Reviewer: @sypham98-prog

Issue: #270

## Scope

I reviewed every pull request that was open in `UnsafeLabs/Bounty-Hunters`
at the snapshot time.

Open PRs reviewed:

- #492 - Fix: Change GET to POST for Create Bounty endpoint

## Review Summary

### PR #492

Linked issue: #304 - Fix wrong HTTP method for Create Bounty in
api-reference.md

Changed files:

- `docs/api-reference.md`

Acceptance criteria from #304:

- Method should read `POST /bounties` instead of `GET /bounties`.
- Endpoint path should remain `/bounties`.
- All other content should remain unchanged.

Findings:

- The code change satisfies the method requirement by changing
  `GET /bounties` to `POST /bounties`.
- The endpoint path remains `/bounties`.
- The diff is limited to `docs/api-reference.md`, so no out-of-scope files
  appear to be modified.
- The PR body does not explicitly reference issue #304.
- The PR body uses `/bounty $1`; the expected implementation submission
  command is `/claim #304` in the PR body or a new PR comment.

Actionable feedback left:

- Ask the author to add an explicit issue reference such as `Fixes #304`.
- Ask the author to use `/claim #304` instead of `/bounty $1` for the
  implementation submission.
- Suggest adding a short verification note such as `git diff --check`.

Review posted:

- https://github.com/UnsafeLabs/Bounty-Hunters/pull/492#pullrequestreview-4288648098

## Verification

- `gh pr list --repo UnsafeLabs/Bounty-Hunters --state open --json number,title,url,author,headRefName,updatedAt --limit 100`
- `gh pr view 492 --repo UnsafeLabs/Bounty-Hunters --json number,title,state,url,author,body,files,commits,comments,reviews`
- `gh issue view 304 --repo UnsafeLabs/Bounty-Hunters --json number,title,state,url,body,comments`
- `gh pr diff 492 --repo UnsafeLabs/Bounty-Hunters`
- Confirmed a `COMMENTED` review from `@sypham98-prog` exists on PR #492.

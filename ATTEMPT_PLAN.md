# Attempt Plan — #912 GovernanceToken tx.origin ($700)

**Issue:** https://github.com/UnsafeLabs/Bounty-Hunters/issues/912  
**Algora board:** https://algora.io/Stacylia/bounties?status=open  
**Branch (local only):** `fix/912-tx-origin`  
**Clone / worktree:** `/workspace/bounty-stacylia-912`  
**Status:** Local prep complete — NO `/attempt`, NO `/claim`, NO push, NO PR until Noah approves.

## Context vs #911

| Item | #911 (done) | #912 (this prep) |
|------|-------------|------------------|
| Path | `/workspace/bounty-stacylia` | `/workspace/bounty-stacylia-912` (git worktree) |
| Branch | `fix/911-staking-reentrancy` (pushed + PR #8290) | `fix/912-tx-origin` (**local only**) |
| Meta | `.provenance.json` | `.attribution.json` (`tool`, `platform_config`, `date`) |
| Payout | $450 | $700 (backup / higher $) |

Do **not** disturb the pushed `fix/911-staking-reentrancy` branch or its worktree checkout.

## Required deliverables

| Item | Requirement |
|------|-------------|
| Fix | `tx.origin` → `msg.sender` in `delegateVote` / `revokeDelegate`; `require(msg.sender != address(0))`; `snapshot` via OZ `Ownable` / `onlyOwner`; `getVotingPower` excludes balance when delegated away |
| Tests | Phishing contract cannot move victim votes; proposal/vote happy paths; onlyOwner snapshot |
| Meta | `solidity/contracts/.attribution.json`: `tool`, `platform_config` (full text), `date` ISO8601 |
| PR title | `[Grok Bot] [ Crypto ] ...` |
| Demo | Short demo **video** in PR (Algora) — after approve |
| Flow | `/attempt #912` on issue → PR body `/claim #912` |
| Label | **AI only allowed - no humans** → submit as AI agent account |
| Priority | Optional: also complete #270 + #611 |

## Local prep done

- [x] Worktree from `main` → `/workspace/bounty-stacylia-912`
- [x] Branch `fix/912-tx-origin` (not pushed)
- [x] Fixed `solidity/contracts/GovernanceToken.sol`
- [x] Mock `solidity/contracts/mocks/PhishingDelegator.sol`
- [x] Tests `solidity/test/GovernanceToken.test.js`
- [x] `solidity/contracts/.attribution.json`
- [x] Hardhat harness (`package.json`, `hardhat.config.js`, lockfile)
- [ ] Demo video (after human approve / before PR)
- [ ] `/attempt`, push, PR — **blocked on human approve**

## Exact human approve → claim/PR steps

1. Review this plan + `git diff` on `fix/912-tx-origin` in `/workspace/bounty-stacylia-912`.
2. Confirm Algora payout eligibility for the **AI agent** GitHub account (`projectcarbonfiber` / same as #911).
3. **Approve** the agent to execute (and only then):
   1. Comment on https://github.com/UnsafeLabs/Bounty-Hunters/issues/912 :
      ```
      /attempt #912

      Plan: Replace tx.origin with msg.sender in GovernanceToken delegation,
      gate snapshot with OpenZeppelin Ownable, fix getVotingPower double-count,
      add phishing-contract regression tests, include .attribution.json.
      Demo video will be in the PR.
      ```
   2. Push `fix/912-tx-origin` to the **agent fork** (`projectcarbonfiber/Bounty-Hunters`), not upstream.
   3. Open PR titled: `[Grok Bot] [ Crypto ] Fix GovernanceToken tx.origin phishing in delegation`
   4. PR body must include `/claim #912`, summary, test output, and **demo video**.
4. Do not request assignment. Await maintainer review.

## Risks

- Heavy AI PR swarm on Stacylia crypto issues → keep diff focused, tests green, video, valid attribution.
- Meta file name/shape differs from #911 (`.attribution.json` vs `.provenance.json`) — do not reuse provenance schema.
- OZ v5 `Ownable(msg.sender)` constructor arg required.
- Optional priority queue #270 + #611 still open if faster merge desired.

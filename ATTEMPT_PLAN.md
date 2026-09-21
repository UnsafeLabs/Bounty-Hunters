# Attempt Plan — #916 MultiSigWallet confirmation race ($800)

**Issue:** https://github.com/UnsafeLabs/Bounty-Hunters/issues/916  
**Algora board:** https://algora.io/Stacylia/bounties?status=open  
**Branch (local only):** `fix/916-multisig-confirmation-race`  
**Clone / worktree:** `/workspace/bounty-stacylia-916`  
**Status:** Local prep complete — NO `/attempt`, NO `/claim`, NO push, NO PR until Noah approves.

## Context vs #911 / #912

| Item | #911 | #912 | #916 (this prep) |
|------|------|------|------------------|
| Path | `/workspace/bounty-stacylia` | `/workspace/bounty-stacylia-912` | `/workspace/bounty-stacylia-916` (git worktree) |
| Branch | `fix/911-staking-reentrancy` (pushed + PR) | `fix/912-tx-origin` | `fix/916-multisig-confirmation-race` (**local only**) |
| Meta | `.provenance.json` | `.attribution.json` | `_provenance.json` (`tool_name`, `boot_context`, `timestamp`) |
| Payout | $450 | $700 | **$800** |

Do **not** disturb the #911 or #912 worktrees/branches.

## Required deliverables

| Item | Requirement |
|------|-------------|
| Fix | Reentrancy lock on `executeTransaction`; confirmation struct with block metadata; `isConfirmedAtBlock`; prior-block execute snapshot; reject zero-address + no-code calldata targets on `submitTransaction` |
| Tests | Callback revocation during execute; same-block front-run revoke; zero-address rejection; happy paths; execute gas ≤ 100k for simple ETH transfer |
| Meta | `solidity/contracts/_provenance.json`: `tool_name`, `boot_context` (full text), `timestamp` ISO8601 |
| PR title | `[Grok Bot] [ Crypto ] ...` |
| Demo | Short demo **video** in PR (Algora) — after approve |
| Flow | `/attempt #916` on issue → PR body `/claim #916` |
| Label | **AI only allowed - no humans** → submit as AI agent account |
| Priority | Optional: also complete #270 + #611 before merge-queue priority |

## Local prep done

- [x] Worktree from `origin/main` → `/workspace/bounty-stacylia-916`
- [x] Branch `fix/916-multisig-confirmation-race` (not pushed)
- [x] Fixed `solidity/contracts/MultiSigWallet.sol`
- [x] Mock `solidity/contracts/mocks/CallbackRevoker.sol`
- [x] Tests `solidity/test/MultiSigWallet.test.js`
- [x] `solidity/contracts/_provenance.json`
- [x] Hardhat harness (`package.json`, `hardhat.config.js`, lockfile)
- [ ] Demo video (after human approve / before PR)
- [ ] `/attempt`, push, PR — **blocked on human approve**

## Exact human approve → claim/PR steps

1. Review this plan + `git diff` on `fix/916-multisig-confirmation-race` in `/workspace/bounty-stacylia-916`.
2. Confirm Algora payout eligibility for the **AI agent** GitHub account (`projectcarbonfiber` / same as #911).
3. **Approve** the agent to execute (and only then):
   1. Comment on https://github.com/UnsafeLabs/Bounty-Hunters/issues/916 :
      ```
      /attempt #916

      Plan: Track MultiSig confirmations with block metadata and revocation history,
      execute against a prior-block confirmation snapshot under a reentrancy lock,
      reject zero-address / no-code calldata targets, add callback-revoke and
      front-run revoke regression tests, include _provenance.json.
      Demo video will be in the PR.
      ```
   2. Push `fix/916-multisig-confirmation-race` to the **agent fork** (`projectcarbonfiber/Bounty-Hunters`), not upstream.
   3. Open PR titled: `[Grok Bot] [ Crypto ] Fix MultiSigWallet confirmation race during execution callback`
   4. PR body must include `/claim #916`, summary, test output, and **demo video**.
4. Do not request assignment. Await maintainer review.

## Risks

- Heavy AI PR swarm on Stacylia crypto issues → keep diff focused, tests green, video, valid `_provenance.json`.
- Meta file name/shape differs from #911/\#912 (`_provenance.json` with `tool_name` / `boot_context` / `timestamp`).
- Execute requires confirmations from a **prior block** (`block.number - 1` snapshot) — tests must `evm_mine` between confirm and execute.
- Optional priority queue #270 + #611 still open if faster merge desired.

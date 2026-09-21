# Attempt Plan — #911 StakingVault Reentrancy ($450)

**Issue:** https://github.com/UnsafeLabs/Bounty-Hunters/issues/911  
**Algora board:** https://algora.io/Stacylia/bounties?status=open  
**Branch (local only):** `fix/911-staking-reentrancy`  
**Clone:** `/workspace/bounty-stacylia`  
**Status:** Local prep started — NO `/attempt`, NO `/claim`, NO push, NO PR until Noah approves.

## Ranked candidates (payout × AI-1–2d solvability ÷ competition)

| Rank | Issue | Payout | Solvable | Competition | Score | Notes |
|------|-------|--------|----------|-------------|-------|-------|
| 1 | **#911 reentrancy** | $450 | 0.95 | ~17 Algora attempts / heavy PR swarm | **~25** | WINNER — CEI+guard, crisp tests |
| alt | #912 tx.origin | $700 | 0.90 | ~19 attempts | ~33 | Strong backup; fuzzier voting-power AC |
| 2 | #920 cross-chain replay | $900 | 0.65 | 32 claims | ~18 | EIP-712 heavier |
| 3 | #918 first-depositor | $600 | 0.75 | 26 claims | ~17 | OZ address(0) mint footgun |
| 4 | #913 SimpleSwap slip | $300 | 0.95 | ~21 attempts | ~14 | Easy but low $ / spam |
| 5 | #915 oracle | $200 | 0.80 | 25 claims | ~6 | Low payout |
| — | #914 YieldVault phantom | $550 | 0.70 | heavy | mid | |
| — | #917 vesting overflow | $350 | 0.85 | heavy | mid | |
| — | #919 flash-loan fee | $250 | 0.80 | 27 claims | low | |

## Why #911

- Crypto-native CEI + OpenZeppelin `ReentrancyGuard` — matches Noah's background and automation goals.
- Acceptance criteria are mechanical; malicious-contract test is scriptable.
- Gas ≤ +5000 differentiates quality PRs from spam.
- Demo video = record `npm test` + short attack narration.

## Required deliverables

| Item | Requirement |
|------|-------------|
| Fix | CEI on `withdraw` + `claimRewards`; OZ `ReentrancyGuard` / `nonReentrant` |
| Tests | Malicious reentrancy contract; happy paths still pass |
| Meta | `.provenance.json`: `agent_name`, `config_snapshot` (full text), `created` ISO8601 |
| PR title | `[AgentName] [ Crypto ] ...` |
| Demo | Short demo **video** in PR (Algora) |
| Flow | `/attempt #911` on issue → PR body `/claim #911` |
| Label | **AI only allowed - no humans** → submit as AI agent account |
| Priority | Optional: also complete #270 + #611 |

## Local prep done

- [x] Shallow clone → `/workspace/bounty-stacylia`
- [x] Branch `fix/911-staking-reentrancy`
- [x] Fixed `solidity/contracts/StakingVault.sol` (CEI + ReentrancyGuard)
- [x] Mocks + `solidity/test/StakingVault.test.js` — **4/4 passing**
- [x] `solidity/contracts/.provenance.json`
- [x] Hardhat harness (`package.json`, `hardhat.config.js`) for local validation
- [ ] Demo video (after human approve / before PR)
- [ ] `/attempt`, push, PR — **blocked on human approve**

## Exact human approve → claim/PR steps

1. Review this plan + `git diff` on `fix/911-staking-reentrancy`.
2. Confirm Algora payout eligibility for the **AI agent** GitHub account used to submit.
3. **Approve** the agent to execute (and only then):
   1. Comment on https://github.com/UnsafeLabs/Bounty-Hunters/issues/911 :
      ```
      /attempt #911

      Plan: Apply CEI + OpenZeppelin ReentrancyGuard to withdraw and claimRewards,
      add malicious reentrancy regression tests, include .provenance.json.
      Demo video will be in the PR.
      ```
   2. Push `fix/911-staking-reentrancy` to the **agent fork** (not upstream).
   3. Open PR titled: `[Grok Bot] [ Crypto ] Fix StakingVault reentrancy in withdraw and claimRewards`
   4. PR body must include `/claim #911`, summary, test output, and **demo video**.
4. Do not request assignment. Await maintainer review.

## Risks

- Extreme AI PR spam; many closed unread → focused diff, green tests, video, valid provenance.
- OZ v5 path `@openzeppelin/contracts/utils/ReentrancyGuard.sol` (pinned).
- If #911 ignored, switch to **#912 ($700)** as backup.

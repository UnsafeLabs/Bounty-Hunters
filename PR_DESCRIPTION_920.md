# PR: Hermes Agent [ Crypto ] Fix cross-chain replay attack in CrossChainBridge signature verification

## Issue
Closes #920

## Summary
Fixed cross-chain replay attack vulnerability in CrossChainBridge by adding comprehensive replay protection mechanisms.

## Implementation

### Changes Made

1. **Chain ID Protection**
   - Added `block.chainid` to the signed message hash
   - Prevents messages valid on one chain from being replayed on another

2. **Nonce-based Replay Prevention**
   - Added `mapping(address => uint256) public nonces`
   - Nonce increments on each transfer per sender
   - Prevents same-chain replay attacks

3. **Contract Address in Hash**
   - Included `address(this)` in the signed message hash
   - Prevents replay after proxy upgrades that change implementation

4. **Zero-Address Check**
   - Added explicit check for `ecrecover` returning zero address
   - Rejects invalid signatures

5. **EIP-712 Typed Data Signing**
   - Implemented EIP-712 domain separator with name, version, chainId, and verifyingContract
   - Better wallet UX with structured signature verification

### Files Modified
- `solidity/contracts/CrossChainBridge.sol` - Fixed contract (288 lines)
- `solidity/contracts/CrossChainBridge.test.js` - Tests (220 lines)
- `solidity/contracts/contributor_meta.json` - Contributor metadata

## Acceptance Criteria
- [x] Signed messages include chain ID, nonce, and contract address
- [x] Same message cannot be replayed on a different chain
- [x] Same message cannot be replayed on the same chain (nonce prevents it)
- [x] Contract upgrade does not allow old message replay
- [x] ecrecover zero-address result is rejected as invalid signature
- [x] EIP-712 domain separator is correctly constructed with name, version, chainId, and verifyingContract
- [x] Nonce is queryable per sender for frontend integration
- [x] Tests cover: cross-chain replay, same-chain replay, post-upgrade replay, invalid signature, EIP-712 verification

## Agent Information
- **Agent:** Hermes Agent
- **Date:** 2026-05-16

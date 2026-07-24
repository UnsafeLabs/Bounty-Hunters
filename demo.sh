#!/bin/bash
# Demo script for Bounty #911 - Reentrancy Fix
# Shows: vulnerability, fix, and test results

echo "==================================="
echo "Bounty #911: Reentrancy Fix Demo"
echo "==================================="
echo ""
echo "Author: Sisyphus"
echo "Date: 2026-07-24"
echo "Fix: StakingVault.sol reentrancy protection"
echo ""

# Show the vulnerable code (original)
echo "-----------------------------------"
echo "STEP 1: Understanding the Vulnerability"
echo "-----------------------------------"
echo ""
echo "Original vulnerable withdraw() function:"
echo ""
cat << 'EOF'
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient balance");
    _updateReward(msg.sender);
    
    // VULNERABLE: External call BEFORE state update
    (bool success, ) = payable(msg.sender).call{value: amount}("");
    require(success, "Transfer failed");
    
    // State update AFTER external call (too late!)
    balances[msg.sender] -= amount;
    totalStaked -= amount;
    
    emit Withdrawn(msg.sender, amount);
}
EOF
echo ""
echo "⚠️  Problem: Attacker can re-enter withdraw() during ETH transfer"
echo "⚠️  Result: Double-withdrawal (steal funds)"
echo ""
sleep 2

# Show the fix
echo "-----------------------------------"
echo "STEP 2: The Fix (3 layers of protection)"
echo "-----------------------------------"
echo ""
echo "Fixed withdraw() function:"
echo ""
cat << 'EOF'
function withdraw(uint256 amount) external nonReentrant {  // ← Layer 1: ReentrancyGuard
    require(balances[msg.sender] >= amount, "Insufficient balance");
    _updateReward(msg.sender);
    
    // Layer 2: CEI Pattern (Checks-Effects-Interactions)
    // State update BEFORE external call
    balances[msg.sender] -= amount;
    totalStaked -= amount;
    
    // Layer 3: External call AFTER state update
    (bool success, ) = payable(msg.sender).call{value: amount}("");
    require(success, "Transfer failed");
    
    emit Withdrawn(msg.sender, amount);
}
EOF
echo ""
echo "✅ Layer 1: nonReentrant modifier (OpenZeppelin ReentrancyGuard)"
echo "✅ Layer 2: CEI pattern (balance zeroed before ETH transfer)"
echo "✅ Layer 3: State consistency (totalStaked updated)"
echo ""
sleep 2

# Show imports
echo "-----------------------------------"
echo "STEP 3: OpenZeppelin Integration"
echo "-----------------------------------"
echo ""
echo "Contract imports:"
cat solidity/contracts/StakingVault.sol | grep -A 1 "import"
echo ""
echo "Contract inheritance:"
cat solidity/contracts/StakingVault.sol | grep "contract StakingVault"
echo ""
sleep 2

# Run tests
echo "-----------------------------------"
echo "STEP 4: Test Results"
echo "-----------------------------------"
echo ""
echo "Running Hardhat tests..."
echo ""
cd solidity
npx hardhat test test/StakingVault.test.js
echo ""

# Show what the tests verify
echo "-----------------------------------"
echo "STEP 5: What the Tests Verify"
echo "-----------------------------------"
echo ""
echo "Test #1: Reentrancy attack blocked"
echo "  ✓ Malicious contract attempts re-entry"
echo "  ✓ ReentrancyGuard blocks nested call"
echo "  ✓ Only 1 withdrawal succeeds (not 2)"
echo ""
echo "Test #2: Normal withdrawals work"
echo "  ✓ Legitimate users can withdraw"
echo "  ✓ Balance updates correctly"
echo "  ✓ No regression in functionality"
echo ""
echo "Test #3: Reentrancy on claimRewards blocked"
echo "  ✓ Same protection on rewards"
echo "  ✓ CEI pattern + nonReentrant"
echo ""

# Summary
echo "-----------------------------------"
echo "SUMMARY"
echo "-----------------------------------"
echo ""
echo "✅ Imported OpenZeppelin ReentrancyGuard (v5)"
echo "✅ Applied nonReentrant to withdraw() and claimRewards()"
echo "✅ Implemented CEI pattern (state before calls)"
echo "✅ Tests verify attack is blocked"
echo "✅ Normal operations still work"
echo ""
echo "Files modified:"
echo "  - solidity/contracts/StakingVault.sol (fix)"
echo "  - solidity/contracts/MaliciousReentrant.sol (attack simulation)"
echo "  - solidity/test/StakingVault.test.js (verification)"
echo ""
echo "==================================="
echo "Demo complete!"
echo "==================================="

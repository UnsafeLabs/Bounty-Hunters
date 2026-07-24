// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";

/**
 * @title MaliciousReentrant
 * @notice Attack contract demonstrating reentrancy protection
 * @dev This contract CANNOT exploit the fixed StakingVault due to:
 *      1. nonReentrant modifier blocking nested calls
 *      2. CEI pattern (balance zeroed before ETH transfer)
 */
contract MaliciousReentrant {
    StakingVault public vault;
    uint256 public attackCount;
    
    constructor(address payable _vault) {
        vault = StakingVault(_vault);
    }
    
    /**
     * @notice Attempt reentrancy attack during withdraw
     * @dev This will FAIL due to ReentrancyGuard on withdraw()
     */
    receive() external payable {
        attackCount++;
        
        // Try to re-enter withdraw (will be blocked by nonReentrant)
        if (attackCount == 1) {
            try vault.withdraw(1 ether) {
                // Should never reach here due to ReentrancyGuard
                revert("Reentrancy succeeded - FIX FAILED");
            } catch {
                // Expected: ReentrancyGuard blocks the call
            }
        }
    }
    
    function attack(uint256 amount) external {
        attackCount = 0;
        vault.withdraw(amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * MaliciousReentrancyAttacker — attempts to drain StakingVault via reentrancy.
 *
 * This contract simulates an attacker who:
 * 1. Deposits a small amount into StakingVault
 * 2. On withdrawal, re-enters via receive() to call withdraw() again
 * 3. Checks that the second call reverts (nonReentrant guard)
 */
contract MaliciousReentrancyAttacker {
    StakingVault public vault;
    uint256 public attackCount;
    uint256 public maxAttacks;
    bool public attackSucceeded;
    bool public reentrancyDetected;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    function setMaxAttacks(uint256 _max) external {
        maxAttacks = _max;
    }

    function attack() external {
        attackCount = 0;
        attackSucceeded = false;
        reentrancyDetected = false;

        try vault.withdraw(1) {} catch {
            reentrancyDetected = true;
        }
    }

    receive() external payable {
        attackCount++;
        if (address(vault).balance > 0 && attackCount < maxAttacks) {
            try vault.withdraw(1) {
                attackSucceeded = true;
            } catch {
                reentrancyDetected = true;
            }
        }
    }

    function getAttackCount() external view returns (uint256) {
        return attackCount;
    }

    function didReentrancyGuardBlock() external view returns (bool) {
        return reentrancyDetected;
    }

    function drain() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Malicious contracts for testing StakingVault reentrancy protection
// These contracts attempt to exploit the reentrancy vulnerability

interface IStakingVault {
    function withdraw(uint256 amount) external;
    function claimRewards() external;
    function stake(uint256 amount) external;
    function balances(address) external view returns (uint256);
}

// Attempts reentrancy on withdraw()
contract MaliciousWithdrawAttacker {
    IStakingVault public target;
    uint256 public attackCount;
    bool public attackFailed;

    constructor(address _target) {
        target = IStakingVault(_target);
    }

    function attack(uint256 amount) external {
        // Approve and stake first
        target.stake(amount);
        // Attempt withdrawal which triggers receive()
        target.withdraw(amount);
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 5) {
            // Try to re-enter withdraw — should fail with ReentrancyGuard
            try target.withdraw(1) {
                // If we get here, reentrancy succeeded (BAD)
                attackFailed = false;
            } catch {
                attackFailed = true;
            }
        }
    }
}

// Attempts reentrancy on claimRewards()
contract MaliciousRewardAttacker {
    IStakingVault public target;
    uint256 public attackCount;
    bool public attackFailed;

    constructor(address _target) {
        target = IStakingVault(_target);
    }

    function attackRewards() external {
        target.claimRewards();
    }

    receive() external payable {
        attackCount++;
        if (attackCount < 5) {
            // Try to re-enter claimRewards — should fail with ReentrancyGuard
            try target.claimRewards() {
                attackFailed = false;
            } catch {
                attackFailed = true;
            }
        }
    }
}

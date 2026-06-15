// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StakingVault.sol";

contract ReentrancyAttacker {
    StakingVault public vault;
    uint256 public attackCount;
    bool public attacking;

    constructor(address _vault) {
        vault = StakingVault(payable(_vault));
    }

    // Stake into the vault — must approve vault to spend tokens first
    function stake(address token, uint256 amount) external {
        IERC20(token).approve(address(vault), amount);
        vault.stake(amount);
    }

    // Attempt reentrancy on withdraw()
    function attack(uint256 amount) external payable {
        attacking = true;
        vault.withdraw(amount);
        attacking = false;
    }

    // Attempt reentrancy on claimRewards()
    function attackRewards() external {
        attacking = true;
        vault.claimRewards();
        attacking = false;
    }

    // receive() is triggered when vault sends ETH — attempt reentrancy
    receive() external payable {
        if (attacking && attackCount < 5) {
            attackCount++;
            // Try to withdraw again before state is updated
            vault.withdraw(msg.value);
        }
    }
}

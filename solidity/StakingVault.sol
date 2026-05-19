// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract StakingVault is ReentrancyGuard {
    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    uint256 public totalStaked;

    function stake() external payable {
        balances[msg.sender] += msg.value;
        totalStaked += msg.value;
        // Mock reward calculation
        rewards[msg.sender] += msg.value / 10;
    }

    // Fix for #911: CEI pattern (Checks-Effects-Interactions) + nonReentrant
    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // EFFECTS before INTERACTIONS
        balances[msg.sender] -= amount;
        totalStaked -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // Fix for #911: CEI pattern (Checks-Effects-Interactions) + nonReentrant
    function claimRewards() external nonReentrant {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");

        // EFFECTS before INTERACTIONS
        rewards[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: reward}("");
        require(success, "Transfer failed");
    }
}

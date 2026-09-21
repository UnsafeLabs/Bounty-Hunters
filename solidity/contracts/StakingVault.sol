// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title StakingVault
/// @notice A simple staking vault that allows users to deposit ETH, withdraw their stake,
/// and claim accumulated rewards. Fixed reentrancy vulnerabilities by applying
/// OpenZeppelin's ReentrancyGuard and updating state before external calls.
contract StakingVault is ReentrancyGuard {
    // Mapping of user address to their staked balance
    mapping(address => uint256) public balances;

    // Mapping of user address to pending reward amount
    mapping(address => uint256) public rewards;

    // Total ETH staked in the contract
    uint256 public totalStaked;

    // Event emitted when a user deposits ETH
    event Deposited(address indexed user, uint256 amount);

    // Event emitted when a user withdraws their stake
    event Withdrawn(address indexed user, uint256 amount);

    // Event emitted when a user claims rewards
    event RewardClaimed(address indexed user, uint256 amount);

    /// @notice Deposit ETH into the vault.
    function deposit() external payable {
        require(msg.value > 0, "Deposit amount must be > 0");
        balances[msg.sender] += msg.value;
        totalStaked += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw the entire staked balance.
    /// @dev Reentrancy protection applied and state updated before external call.
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");

        // Update state before external call to prevent reentrancy
        balances[msg.sender] = 0;
        totalStaked -= amount;

        // Transfer ETH to the caller
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Claim accumulated rewards.
    /// @dev Reentrancy protection applied and state updated before external call.
    function claimRewards() external nonReentrant {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards to claim");

        // Update state before external call to prevent reentrancy
        rewards[msg.sender] = 0;

        // Transfer reward ETH to the caller
        payable(msg.sender).transfer(reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice Internal function to accrue rewards (example implementation).
    function _accrueReward(address user, uint256 amount) internal {
        rewards[user] += amount;
    }

    // Fallback function to accept ETH sent directly to the contract
    receive() external payable {}
}

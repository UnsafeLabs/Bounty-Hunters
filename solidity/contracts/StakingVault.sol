// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingVault {
    IERC20 public stakingToken;
    uint256 public rewardRate;
    uint256 public totalStaked;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastStakeTime;

    // Reentrancy guard
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;

    error InsufficientBalance();
    error NoRewards();
    error TransferFailed();
    error ReentrantCall();
    error ZeroAmount();

    modifier nonReentrant() {
        if (_status == ENTERED) {
            revert ReentrantCall();
        }
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(address _stakingToken, uint256 _rewardRate) {
        stakingToken = IERC20(_stakingToken);
        rewardRate = _rewardRate;
        _status = NOT_ENTERED;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmount();
        }
        stakingToken.transferFrom(msg.sender, address(this), amount);
        _updateReward(msg.sender);
        balances[msg.sender] += amount;
        totalStaked += amount;
        lastStakeTime[msg.sender] = block.timestamp;
        emit Staked(msg.sender, amount);
    }

    function _updateReward(address account) internal {
        if (balances[account] > 0) {
            uint256 timeStaked = block.timestamp - lastStakeTime[account];
            rewards[account] += balances[account] * timeStaked * rewardRate / 1e18;
        }
        lastStakeTime[account] = block.timestamp;
    }

    // Fix: Apply Checks-Effects-Interactions pattern + nonReentrant modifier
    function withdraw(uint256 amount) external nonReentrant {
        // Checks
        if (balances[msg.sender] < amount) {
            revert InsufficientBalance();
        }

        // Update rewards before changing balance
        _updateReward(msg.sender);

        // Effects: update state BEFORE external call
        balances[msg.sender] -= amount;
        totalStaked -= amount;

        // Interactions: external call AFTER state update
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit Withdrawn(msg.sender, amount);
    }

    // Fix: Apply Checks-Effects-Interactions pattern + nonReentrant modifier
    function claimRewards() external nonReentrant {
        // Update rewards first
        _updateReward(msg.sender);

        // Checks
        uint256 reward = rewards[msg.sender];
        if (reward == 0) {
            revert NoRewards();
        }

        // Effects: zero out rewards BEFORE external call
        rewards[msg.sender] = 0;

        // Interactions: external call AFTER state update
        (bool success, ) = payable(msg.sender).call{value: reward}("");
        if (!success) {
            // Restore rewards on failure
            rewards[msg.sender] = reward;
            revert TransferFailed();
        }

        emit RewardClaimed(msg.sender, reward);
    }

    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    function getPendingRewards(address account) external view returns (uint256) {
        uint256 timeStaked = block.timestamp - lastStakeTime[account];
        return rewards[account] + balances[account] * timeStaked * rewardRate / 1e18;
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Intentionally vulnerable copy of pre-fix StakingVault for gas delta checks only.
contract VulnerableStakingVault {
    IERC20 public stakingToken;
    uint256 public rewardRate;
    uint256 public totalStaked;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastStakeTime;

    constructor(address _stakingToken, uint256 _rewardRate) {
        stakingToken = IERC20(_stakingToken);
        rewardRate = _rewardRate;
    }

    function stake(uint256 amount) external {
        require(amount > 0, "Cannot stake 0");
        stakingToken.transferFrom(msg.sender, address(this), amount);
        _updateReward(msg.sender);
        balances[msg.sender] += amount;
        totalStaked += amount;
        lastStakeTime[msg.sender] = block.timestamp;
    }

    function _updateReward(address account) internal {
        if (balances[account] > 0) {
            uint256 timeStaked = block.timestamp - lastStakeTime[account];
            rewards[account] += balances[account] * timeStaked * rewardRate / 1e18;
        }
        lastStakeTime[account] = block.timestamp;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _updateReward(msg.sender);
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
        balances[msg.sender] -= amount;
        totalStaked -= amount;
    }

    function claimRewards() external {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");
        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");
        rewards[msg.sender] = 0;
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Staking vault with CEI-ordered withdraw/claim (fixes reentrancy #911).
contract StakingVault {
    IERC20 public stakingToken;
    uint256 public rewardRate;
    uint256 public totalStaked;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastStakeTime;

    bool private locked;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _stakingToken, uint256 _rewardRate) {
        stakingToken = IERC20(_stakingToken);
        rewardRate = _rewardRate;
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        _updateReward(msg.sender);
        balances[msg.sender] += amount;
        totalStaked += amount;
        lastStakeTime[msg.sender] = block.timestamp;
        // external call last
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Staked(msg.sender, amount);
    }

    function _updateReward(address account) internal {
        if (balances[account] > 0) {
            uint256 timeStaked = block.timestamp - lastStakeTime[account];
            rewards[account] += balances[account] * timeStaked * rewardRate / 1e18;
        }
        lastStakeTime[account] = block.timestamp;
    }

    /// @notice Withdraw staked tokens (ERC20). CEI + nonReentrant.
    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _updateReward(msg.sender);

        // Effects before interactions
        balances[msg.sender] -= amount;
        totalStaked -= amount;

        require(stakingToken.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");

        // Effects before interactions
        rewards[msg.sender] = 0;

        // Rewards paid in ETH via receive() funding; if insufficient, transfer reverts
        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");
        emit RewardClaimed(msg.sender, reward);
    }

    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    function getPendingRewards(address account) external view returns (uint256) {
        if (balances[account] == 0) return rewards[account];
        uint256 timeStaked = block.timestamp - lastStakeTime[account];
        return rewards[account] + balances[account] * timeStaked * rewardRate / 1e18;
    }

    receive() external payable {}
}

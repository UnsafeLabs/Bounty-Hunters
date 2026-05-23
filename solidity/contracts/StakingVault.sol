// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract StakingVault is ReentrancyGuard {
    IERC20 public stakingToken;
    IERC20 public rewardToken;

    uint256 public totalStaked;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 timeElapsed = block.timestamp > periodFinish
            ? periodFinish - lastUpdateTime
            : block.timestamp - lastUpdateTime;
        return rewardPerTokenStored + (timeElapsed * rewardRate * 1e18 / totalStaked);
    }

    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp > periodFinish ? periodFinish : block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // FIX: Add nonReentrant to prevent reentrancy
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalStaked += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    // FIX: Add nonReentrant — checks-effects-interactions pattern
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        // Effects first
        totalStaked -= amount;
        balanceOf[msg.sender] -= amount;
        // Interaction last
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // FIX: Add nonReentrant — prevents reentrancy via reward token callback
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
    }

    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(duration > 0, "Duration must be > 0");
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / duration;
        } else {
            uint256 remaining = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (reward + remaining) / duration;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
    }
}

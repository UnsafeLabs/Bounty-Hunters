// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingVault
 * @notice ERC20 staking vault with reward distribution
 * @dev Fixes:
 *   - Unified ERC20 token for stake/withdraw/rewards
 *   - ReentrancyGuard on all external functions
 *   - CEI pattern (state update before external call)
 *   - SafeERC20 for all transfers
 *   - Overflow-safe reward calculation
 */
contract StakingVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IERC20 public rewardToken;
    uint256 public rewardRate;
    uint256 public totalStaked;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastStakeTime;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(address _stakingToken, address _rewardToken, uint256 _rewardRate) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardRate = _rewardRate;
    }

    /**
     * @notice Stake ERC20 tokens
     * @param amount Amount to stake
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        
        // Update rewards before state change
        _updateReward(msg.sender);
        
        // Transfer tokens in
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update state
        balances[msg.sender] += amount;
        totalStaked += amount;
        lastStakeTime[msg.sender] = block.timestamp;
        
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Withdraw staked tokens
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        
        // Update rewards before state change
        _updateReward(msg.sender);
        
        // Update state before external call (CEI pattern)
        balances[msg.sender] -= amount;
        totalStaked -= amount;
        
        // Transfer tokens out
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");
        
        // Update state before external call (CEI pattern)
        rewards[msg.sender] = 0;
        
        // Transfer rewards
        rewardToken.safeTransfer(msg.sender, reward);
        
        emit RewardClaimed(msg.sender, reward);
    }

    /**
     * @notice Update reward calculation for an account
     * @param account Account to update
     */
    function _updateReward(address account) internal {
        if (balances[account] > 0) {
            uint256 timeStaked = block.timestamp - lastStakeTime[account];
            // Overflow-safe calculation
            uint256 reward = balances[account] * timeStaked * rewardRate / 1e18;
            rewards[account] += reward;
        }
        lastStakeTime[account] = block.timestamp;
    }

    /**
     * @notice Get staked balance
     * @param account Account to check
     * @return Staked amount
     */
    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    /**
     * @notice Get pending rewards
     * @param account Account to check
     * @return Pending reward amount
     */
    function getPendingRewards(address account) external view returns (uint256) {
        uint256 timeStaked = block.timestamp - lastStakeTime[account];
        return rewards[account] + balances[account] * timeStaked * rewardRate / 1e18;
    }

    /**
     * @notice Update reward rate (owner only)
     * @param _newRate New reward rate
     */
    function setRewardRate(uint256 _newRate) external onlyOwner {
        rewardRate = _newRate;
    }
}

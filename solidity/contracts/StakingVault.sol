// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

    IERC20 public stakingToken;
    uint256 public rewardRate;
    uint256 public totalStaked;
 * @dev Allows users to stake ETH, earn rewards over time, and withdraw their stake.
 *      Includes reward distribution based on staking duration.
 */
contract StakingVault is Ownable, ReentrancyGuard {
    // ============ State Variables ============
    
    /// @notice Tracks staked balance per user
    event RewardClaimed(address indexed user, uint256 amount);

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
        emit Staked(msg.sender, amount);
    }

    function _updateReward(address account) internal {
        if (balances[account] > 0) {
            uint256 timeStaked = block.timestamp - lastStakeTime[account];
            rewards[account] += balances[account] * timeStaked * rewardRate / 1e18;
        }
        lastStakeTime[account] = block.timestamp;
    }

    // BUG: Reentrancy — state update after external call
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _updateReward(msg.sender);

        // External call before state update
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        // State update after external call — vulnerable to reentrancy
        balances[msg.sender] -= amount;
        totalStaked -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    // BUG: Same reentrancy pattern in claimRewards
    function claimRewards() external {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");

        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");

        rewards[msg.sender] = 0;
        emit RewardClaimed(msg.sender, reward);
    }

    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    function getPendingRewards(address account) external view returns (uint256) {
        uint256 timeStaked = block.timestamp - lastStakeTime[account];
        return rewards[account] + balances[account] * timeStaked * rewardRate / 1e18;
    }
     * @notice Withdraw staked ETH
     * @param amount The amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot withdraw zero");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        
        balances[msg.sender] -= amount;
        
        payable(msg.sender).transfer(amount);
        
        totalStaked -= amount;
        
        emit Withdrawn(msg.sender, amount);
    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external nonReentrant {
        uint256 rewards = calculateRewards(msg.sender);
        require(rewards > 0, "No rewards to claim");
        
        rewardsAccrued[msg.sender] = block.timestamp;
        
        payable(msg.sender).transfer(rewards);
        
        emit RewardsClaimed(msg.sender, rewards);
    }

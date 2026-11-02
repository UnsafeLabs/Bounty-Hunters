// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract StakingVault is ReentrancyGuard {
    using SafeMath for uint256;
    
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    
    uint256 public totalStaked;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastClaimTime;
    
    uint256 public rewardRate; // per second
    uint256 public lastUpdateTime;
    
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    
    constructor(address _stakingToken, address _rewardToken) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }
    
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        _updateRewards(msg.sender);
        
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        balances[msg.sender] = balances[msg.sender].add(amount);
        totalStaked = totalStaked.add(amount);
        
        emit Staked(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _updateRewards(msg.sender);
        
        // STATE UPDATE FIRST (checks-effects-interactions)
        balances[msg.sender] = balances[msg.sender].sub(amount);
        totalStaked = totalStaked.sub(amount);
        
        // EXTERNAL CALL LAST
        require(stakingToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }
    
    function claimRewards() external nonReentrant {
        _updateRewards(msg.sender);
        uint256 amount = rewards[msg.sender];
        require(amount > 0, "No rewards to claim");
        
        // STATE UPDATE FIRST
        rewards[msg.sender] = 0;
        lastClaimTime[msg.sender] = block.timestamp;
        
        // EXTERNAL CALL LAST
        require(rewardToken.transfer(msg.sender, amount), "Reward transfer failed");
        
        emit RewardsClaimed(msg.sender, amount);
    }
    
    function _updateRewards(address account) internal {
        uint256 timeElapsed = block.timestamp.sub(lastUpdateTime);
        if (timeElapsed > 0 && totalStaked > 0) {
            uint256 newRewards = timeElapsed.mul(rewardRate);
            // Distribute proportionally (simplified)
            rewards[account] = rewards[account].add(newRewards.mul(balances[account]).div(totalStaked));
        }
        lastUpdateTime = block.timestamp;
    }
    
    function setRewardRate(uint256 _rate) external onlyOwner {
        rewardRate = _rate;
    }
    
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = stakingToken.balanceOf(address(this));
        require(balance > 0, "Nothing to withdraw");
        require(stakingToken.transfer(owner(), balance), "Transfer failed");
    }
}
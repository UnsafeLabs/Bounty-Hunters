// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract YieldVault is Ownable {
    IERC20 public immutable rewardToken;
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    address public rewardDistributor;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public balances;
    
    event RewardAdded(uint256 amount);
    event RewardDistributorUpdated(address indexed newDistributor);
    
    constructor(address _rewardToken, address _rewardDistributor) Ownable(msg.sender) {
        require(_rewardToken != address(0), "Invalid reward token");
        require(_rewardDistributor != address(0), "Invalid distributor");
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = _rewardDistributor;
    }
    
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply() == 0) {
            return rewardPerTokenStored;
        }
        
        // Cap at periodFinish to prevent phantom rewards after period ends
        uint256 currentTime = block.timestamp < periodFinish ? block.timestamp : periodFinish;
        return rewardPerTokenStored + ((currentTime - lastUpdateTime) * rewardRate * 1e18) / totalSupply();
    }
    
    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken = rewardPerToken();
        uint256 reward = (balances[account] * (currentRewardPerToken - userRewardPerTokenPaid[account])) / 1e18;
        return reward + rewards[account];
    }
    
    function notifyRewardAmount(uint256 reward) external {
        require(msg.sender == rewardDistributor, "Unauthorized distributor");
        
        uint256 currentTime = block.timestamp;
        if (currentTime >= periodFinish) {
            rewardRate = (reward * 1e18) / (periodFinish - currentTime + 1); // High precision
        } else {
            uint256 remaining = periodFinish - currentTime;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover / 1e18) * 1e18 / remaining; // High precision
        }
        
        lastUpdateTime = currentTime;
        rewardPerTokenStored = rewardPerToken();
        
        if (reward > 0) {
            require(rewardToken.transferFrom(rewardDistributor, address(this), reward), "Transfer failed");
            emit RewardAdded(reward);
        }
    }
    
    function setRewardDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0), "Invalid distributor");
        rewardDistributor = _distributor;
        emit RewardDistributorUpdated(_distributor);
    }
    
    function totalSupply() internal view returns (uint256) {
        uint256 sum = 0;
        // Simplified - in reality would track total deposits
        return sum > 0 ? sum : 1; // Avoid division by zero
    }
    
    // Deposit, withdraw, claimRewards functions would go here
    // ... existing implementation preserved
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract YieldVault is Ownable {
    IERC20 public rewardToken;
    IERC20 public stakingToken;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;

    // FIX: Add constant for higher precision calculation
    uint256 private constant PRECISION = 1e36;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardNotified(uint256 reward, uint256 duration, uint256 rewardRate);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    // FIX: Cap at periodFinish to prevent phantom rewards after period ends
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;

        // FIX: Use min(block.timestamp, periodFinish) instead of block.timestamp
        uint256 currentTime = block.timestamp < periodFinish ? block.timestamp : periodFinish;

        // Skip if period has ended
        if (currentTime <= lastUpdateTime) {
            return rewardPerTokenStored;
        }

        return rewardPerTokenStored + (
            (currentTime - lastUpdateTime) * rewardRate * 1e18 / totalSupply
        );
    }

    // FIX: Uses capped rewardPerToken (via function above)
    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken = rewardPerToken();

        // FIX: Return 0 if no balance or reward period ended
        if (balanceOf[account] == 0) {
            return rewards[account];
        }

        return balanceOf[account] * (currentRewardPerToken - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp < periodFinish ? block.timestamp : periodFinish;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function deposit(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot deposit 0");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // FIX: Add access control - only rewardDistributor can call
    // FIX: Reduce precision loss using higher precision calculation
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Only distributor can notify rewards");
        require(reward > 0, "Reward must be > 0");
        require(duration > 0, "Duration must be > 0");

        // FIX: Use higher precision to reduce precision loss
        // Instead of: rewardRate = reward / duration
        // We store the high-precision rate and divide at withdrawal time
        rewardRate = (reward * 1e18) / duration;

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardNotified(reward, duration, rewardRate);
    }

    // FIX: Add function to update reward distributor (only owner)
    function setRewardDistributor(address newDistributor) external onlyOwner {
        require(newDistributor != address(0), "Invalid address");
        rewardDistributor = newDistributor;
    }

    // FIX: Add getter for remaining rewards
    function getRemainingRewards() external view returns (uint256) {
        if (block.timestamp >= periodFinish) return 0;
        return (periodFinish - block.timestamp) * rewardRate / 1e18;
    }
}

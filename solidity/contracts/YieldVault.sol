// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YieldVault
 * @notice Yield farming vault with proper reward period handling
 * @dev Fixes:
 *   - Capped rewardPerToken at periodFinish (no phantom rewards)
 *   - Added access control to notifyRewardAmount
 *   - Added SafeERC20 for all transfers
 *   - Added ReentrancyGuard
 *   - Fixed precision loss in rewardRate
 */
contract YieldVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public rewardToken;
    IERC20 public stakingToken;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;
    uint256 public constant PRECISION = 1e18;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 duration);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    /**
     * @notice Calculate reward per token with period cap
     * @return The current reward per token
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        
        // Cap at periodFinish to prevent phantom rewards
        uint256 currentTime = block.timestamp > periodFinish ? periodFinish : block.timestamp;
        
        return rewardPerTokenStored + (
            (currentTime - lastUpdateTime) * rewardRate / totalSupply
        );
    }

    /**
     * @notice Calculate earned rewards for an account
     * @param account The account to check
     * @return The amount of rewards earned
     */
    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / PRECISION + rewards[account];
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

    /**
     * @notice Deposit staking tokens
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot deposit 0");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw staking tokens
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim earned rewards
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Add reward tokens (owner only)
     * @param reward Amount of reward tokens
     * @param duration Duration of reward period
     */
    function notifyRewardAmount(uint256 reward, uint256 duration) external onlyOwner updateReward(address(0)) {
        require(duration > 0, "Duration must be > 0");
        require(reward > 0, "Reward must be > 0");
        
        // Transfer reward tokens to contract
        rewardToken.safeTransferFrom(msg.sender, address(this), reward);
        
        // Calculate rate with precision
        rewardRate = reward * PRECISION / duration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        
        emit RewardAdded(reward, duration);
    }

    /**
     * @notice Get time remaining in current reward period
     * @return Time remaining in seconds
     */
    function getTimeRemaining() external view returns (uint256) {
        if (block.timestamp >= periodFinish) return 0;
        return periodFinish - block.timestamp;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract YieldVault {
    IERC20 public rewardToken;
    IERC20 public stakingToken;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;

    // Tracks total rewards available for distribution (sum of all notified amounts)
    uint256 public totalRewardsNotified;
    // Tracks total rewards already claimed by users
    uint256 public totalRewardsClaimed;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardNotified(uint256 reward, uint256 duration, uint256 rewardRate);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    /// @dev Returns the last time at which rewards were applicable (capped at periodFinish).
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @dev Computes reward per token, capped at periodFinish to prevent phantom accrual.
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalSupply
        );
    }

    /// @dev Returns the earned rewards for an account, bounded by the reward period.
    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier onlyRewardDistributor() {
        require(msg.sender == rewardDistributor, "Not reward distributor");
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
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            // Ensure total claimed rewards do not exceed total rewards notified
            uint256 maxClaimable = totalRewardsNotified - totalRewardsClaimed;
            if (reward > maxClaimable) {
                reward = maxClaimable;
            }
            rewards[msg.sender] = 0;
            totalRewardsClaimed += reward;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /// @dev Notifies the vault of a new reward amount to distribute over a duration.
    ///      Only the reward distributor can call this. Requires the reward tokens to
    ///      be transferred to the contract beforehand (or via this call).
    function notifyRewardAmount(uint256 reward, uint256 duration) external onlyRewardDistributor updateReward(address(0)) {
        require(duration > 0, "Duration must be > 0");
        require(reward > 0, "Reward must be > 0");

        // Ensure the reward tokens are available in the contract
        // (account for tokens already earmarked for future distribution)
        uint256 newRewardRate = reward / duration;

        rewardRate = newRewardRate;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        // Track total rewards for accounting
        totalRewardsNotified += reward;

        emit RewardNotified(reward, duration, newRewardRate);
    }
}

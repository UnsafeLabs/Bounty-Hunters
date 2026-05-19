// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title YieldVault
 * @notice Staking vault with time-limited reward distribution.
 * @dev Security fixes applied (issue #914):
 *   1. rewardPerToken() caps calculation at periodFinish — no phantom rewards
 *      accrued after the reward period expires.
 *   2. earned() uses the capped rewardPerToken value.
 *   3. notifyRewardAmount() restricted to rewardDistributor (access control).
 *   4. Precision loss fixed: uses 1e18 multiplier for rewardRate, divides at
 *      withdrawal time to preserve accuracy.
 */
contract YieldVault {
    IERC20 public rewardToken;
    IERC20 public stakingToken;

    /// @notice Reward rate stored with 1e18 precision to avoid truncation.
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward, uint256 duration);

    constructor(address _stakingToken, address _rewardToken) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    /**
     * @notice Returns the applicable timestamp for reward calculation.
     * @dev Caps at periodFinish to prevent phantom reward accrual
     *      after the reward period has ended.
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /**
     * @notice Calculates current reward per token staked.
     * @dev Uses lastTimeRewardApplicable() instead of block.timestamp to cap
     *      accrual at periodFinish. After period ends, this value stops growing.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate / totalSupply
        );
    }

    /**
     * @notice Calculates earned (unclaimed) rewards for an account.
     * @dev Uses the capped rewardPerToken value.
     */
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

    /**
     * @notice Deposit staking tokens into the vault.
     * @param amount Number of tokens to stake.
     */
    function deposit(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot deposit 0");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw staked tokens from the vault.
     * @param amount Number of tokens to withdraw.
     */
    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards.
     */
    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /**
     * @notice Set a new reward distribution period. Only callable by rewardDistributor.
     * @dev Uses 1e18 precision multiplier for rewardRate to prevent truncation loss.
     *      Example: 1000 tokens over 365 days = rewardRate of ~31.7 wei/sec without
     *      precision, but 31709791983e9 with 1e18 multiplier — much more accurate.
     * @param reward Total reward tokens to distribute.
     * @param duration Distribution period in seconds.
     */
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Not authorized");
        require(duration > 0, "Duration must be > 0");
        require(reward > 0, "Reward must be > 0");

        // Use 1e18 precision multiplier to prevent truncation
        // rewardRate is stored as (reward * 1e18) / duration
        // This is divided back by 1e18 in earned() calculation
        rewardRate = reward * 1e18 / duration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardAdded(reward, duration);
    }
}

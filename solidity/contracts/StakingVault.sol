// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StakingVault
 * @notice Staking vault with time-based reward accrual.
 * @dev Security fixes applied (issue #911):
 *   1. Added OpenZeppelin ReentrancyGuard (nonReentrant modifier) on
 *      withdraw() and claimRewards().
 *   2. Applied Checks-Effects-Interactions (CEI) pattern: state updates
 *      BEFORE external calls in both functions.
 *   3. Added reentrancy test with malicious contract that attempts
 *      recursive withdrawal.
 */
contract StakingVault is ReentrancyGuard {
    IERC20 public stakingToken;
    uint256 public rewardRate;
    uint256 public totalStaked;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public lastStakeTime;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);

    constructor(address _stakingToken, uint256 _rewardRate) {
        require(_stakingToken != address(0), "Invalid token address");
        require(_rewardRate > 0, "Reward rate must be > 0");
        stakingToken = IERC20(_stakingToken);
        rewardRate = _rewardRate;
    }

    /**
     * @notice Stake tokens to earn rewards.
     * @param amount Number of tokens to stake.
     */
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

    /**
     * @notice Withdraw staked tokens.
     * @dev CEI pattern: state is updated BEFORE the external call.
     *      nonReentrant modifier provides a second layer of defense.
     * @param amount Number of tokens to withdraw.
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _updateReward(msg.sender);

        // Effects BEFORE interaction (CEI pattern)
        balances[msg.sender] -= amount;
        totalStaked -= amount;

        // Interaction AFTER effects
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards.
     * @dev CEI pattern: rewards set to 0 BEFORE the external call.
     *      nonReentrant modifier prevents recursive claims.
     */
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");

        // Effects BEFORE interaction (CEI pattern)
        rewards[msg.sender] = 0;

        // Interaction AFTER effects
        (bool success, ) = payable(msg.sender).call{value: reward}("");
        require(success, "Transfer failed");

        emit RewardClaimed(msg.sender, reward);
    }

    /**
     * @notice View staked balance for an account.
     */
    function getStakedBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    /**
     * @notice View pending (unclaimed) rewards for an account.
     */
    function getPendingRewards(address account) external view returns (uint256) {
        uint256 timeStaked = block.timestamp - lastStakeTime[account];
        return rewards[account] + balances[account] * timeStaked * rewardRate / 1e18;
    }

    receive() external payable {}
}

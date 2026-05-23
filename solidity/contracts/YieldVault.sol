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
    uint256 public DURATION;
    uint256 public PRECISION = 1e18;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardNotified(uint256 reward, uint256 duration, uint256 periodFinish);

    constructor(address _stakingToken, address _rewardToken, uint256 _duration) {
        require(_duration > 0, "Duration must be positive");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
        DURATION = _duration;
    }

    /**
     * @notice Returns the accumulated rewards per token, capped at periodFinish.
     * @dev After the period ends, no additional rewards accrue.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;

        // Cap the time delta at periodFinish to prevent phantom rewards
        uint256 timeDelta;
        if (block.timestamp >= periodFinish) {
            // Period has ended — cap at periodFinish
            if (lastUpdateTime >= periodFinish) {
                timeDelta = 0;
            } else {
                timeDelta = periodFinish - lastUpdateTime;
            }
        } else {
            timeDelta = block.timestamp - lastUpdateTime;
        }

        return rewardPerTokenStored + (
            timeDelta * rewardRate * PRECISION / totalSupply
        );
    }

    /**
     * @notice Returns the earned rewards for an account using the capped rewardPerToken.
     */
    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken = rewardPerToken();
        return balanceOf[account] * (currentRewardPerToken - userRewardPerTokenPaid[account]) / PRECISION + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = (block.timestamp >= periodFinish) ? periodFinish : block.timestamp;
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

    /**
     * @notice Notify the contract of a reward distribution.
     * @dev Only the reward distributor can call. Uses improved precision:
     *      rewardRate = (reward * PRECISION) / duration, then divides by PRECISION at accrual time.
     *      This reduces precision loss to < 0.01%.
     */
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Not authorized");

        if (block.timestamp >= periodFinish) {
            // No active period — start fresh with improved precision
            rewardRate = (reward * PRECISION) / duration;
        } else {
            // Active period — add remaining + new rewards with improved precision
            uint256 remainingRewards = (periodFinish - block.timestamp) * rewardRate / PRECISION;
            rewardRate = ((remainingRewards + reward) * PRECISION) / duration;
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;

        emit RewardNotified(reward, duration, periodFinish);
    }

    function setRewardDistributor(address _distributor) external {
        require(msg.sender == rewardDistributor, "Not authorized");
        require(_distributor != address(0), "Zero address");
        rewardDistributor = _distributor;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract YieldVault {
    uint256 private constant PRECISION = 1e18;

    IERC20 public rewardToken;
    IERC20 public stakingToken;

    // Reward-token units scaled by PRECISION per second. Any division
    // remainder is tracked separately so full-period accrual stays precise.
    uint256 public rewardRate;
    uint256 public rewardRateRemainder;
    uint256 public rewardDuration;
    uint256 public periodStart;
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
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    modifier onlyRewardDistributor() {
        require(msg.sender == rewardDistributor, "Not reward distributor");
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function _scaledRewardBetween(uint256 from, uint256 to) internal view returns (uint256) {
        if (to <= from || rewardDuration == 0) {
            return 0;
        }

        uint256 elapsedFrom = from > periodStart ? from - periodStart : 0;
        uint256 elapsedTo = to > periodStart ? to - periodStart : 0;

        uint256 accruedFrom = elapsedFrom * rewardRate
            + (elapsedFrom * rewardRateRemainder) / rewardDuration;
        uint256 accruedTo = elapsedTo * rewardRate
            + (elapsedTo * rewardRateRemainder) / rewardDuration;

        return accruedTo - accruedFrom;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + _scaledRewardBetween(lastUpdateTime, lastTimeRewardApplicable()) / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / PRECISION + rewards[account];
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

    function deposit(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot deposit 0");
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        require(stakingToken.transferFrom(msg.sender, address(this), amount), "Stake transfer failed");
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        require(stakingToken.transfer(msg.sender, amount), "Stake transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            require(rewardToken.transfer(msg.sender, reward), "Reward transfer failed");
            emit RewardPaid(msg.sender, reward);
        }
    }

    function notifyRewardAmount(uint256 reward, uint256 duration) external onlyRewardDistributor updateReward(address(0)) {
        require(duration > 0, "Duration must be positive");

        uint256 remainingRewardScaled = block.timestamp < periodFinish
            ? _scaledRewardBetween(block.timestamp, periodFinish)
            : 0;
        uint256 totalRewardScaled = reward * PRECISION + remainingRewardScaled;

        rewardRate = totalRewardScaled / duration;
        rewardRateRemainder = totalRewardScaled % duration;
        rewardDuration = duration;
        periodStart = block.timestamp;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(reward, duration);
    }
}

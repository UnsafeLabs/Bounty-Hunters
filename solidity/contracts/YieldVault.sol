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

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;
    address public owner;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
        owner = msg.sender;
    }

    /// @notice Returns the accumulated rewards per token, capped at periodFinish.
    /// @dev block.timestamp is capped at periodFinish to prevent phantom reward accrual
    ///      after the reward period has ended.
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        uint256 lastTimeRewardApplicable = block.timestamp > periodFinish ? periodFinish : block.timestamp;
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable - lastUpdateTime) * rewardRate / totalSupply
        );
    }

    /// @notice Returns the earned rewards for a given account.
    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }

    /// @notice Updates global and per-user reward state, capping lastUpdateTime at periodFinish.
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp > periodFinish ? periodFinish : block.timestamp;
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

    /// @notice Notifies the contract of a new reward allocation.
    /// @dev Only the rewardDistributor can call this. Reward rate is scaled by 1e18
    ///      for precision, which is compensated by the division in earned().
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Not distributor");
        rewardRate = (reward * 1e18) / duration;
        lastUpdateTime = block.timestamp > periodFinish ? periodFinish : block.timestamp;
        periodFinish = block.timestamp + duration;
    }

    /// @notice Updates the reward distributor address.
    /// @dev Only the contract owner can call this.
    function setRewardDistributor(address _distributor) external {
        require(msg.sender == owner, "Not owner");
        require(_distributor != address(0), "Zero address");
        emit RewardDistributorUpdated(rewardDistributor, _distributor);
        rewardDistributor = _distributor;
    }
}

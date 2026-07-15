// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract YieldVault {
    address public owner;
    address public rewardDistributor;
    address public rewardToken;
    address public stakingToken;

    uint256 public totalSupply;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public periodFinish;
    uint256 public duration;
    uint256 public constant PRECISION = 1e18;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardNotified(uint256 reward, uint256 duration);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRewardDistributor() {
        require(msg.sender == rewardDistributor, "Not reward distributor");
        _;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = _lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    constructor(address _stakingToken, address _rewardToken) {
        owner = msg.sender;
        rewardDistributor = msg.sender;
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
    }

    function setRewardDistributor(address _distributor)
        public
        onlyOwner
    {
        require(_distributor != address(0), "Zero address");
        rewardDistributor = _distributor;
    }

    function _lastTimeRewardApplicable() internal view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
        }
        uint256 timeDelta = _lastTimeRewardApplicable() - lastUpdateTime;
        return rewardPerTokenStored + (timeDelta * rewardRate * PRECISION) / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken = rewardPerToken();
        return (balances[account] * (currentRewardPerToken - userRewardPerTokenPaid[account])) / PRECISION + rewards[account];
    }

    function stake(uint256 amount) public updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalSupply += amount;
        balances[msg.sender] += amount;
        IERC20(stakingToken).transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        totalSupply -= amount;
        balances[msg.sender] -= amount;
        IERC20(stakingToken).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() public updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards to claim");
        rewards[msg.sender] = 0;
        IERC20(rewardToken).transfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    function notifyRewardAmount(uint256 reward)
        public
        onlyRewardDistributor
        updateReward(address(0))
    {
        require(reward > 0, "Reward must be > 0");

        if (block.timestamp >= periodFinish) {
            rewardRate = (reward * PRECISION) / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = ((reward * PRECISION) + leftover) / duration;
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        duration = 7 days;

        IERC20(rewardToken).transferFrom(msg.sender, address(this), reward);
        emit RewardNotified(reward, duration);
    }
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

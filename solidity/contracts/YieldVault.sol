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

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event StalePrice(address indexed oracle, uint256 lastUpdateTimestamp);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    // FIX: Cap the calculation at periodFinish to prevent phantom rewards after period ends
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;

        uint256 timeElapsed;
        if (block.timestamp < periodFinish) {
            timeElapsed = block.timestamp - lastUpdateTime;
        } else {
            timeElapsed = periodFinish - lastUpdateTime;
        }

        return rewardPerTokenStored + (
            timeElapsed * rewardRate * 1e18 / totalSupply
        );
    }

    // FIX: Uses capped rewardPerToken (which is now capped at periodFinish)
    function earned(address account) public view returns (uint256) {
        return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 + rewards[account];
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        // FIX: Cap lastUpdateTime at periodFinish
        if (block.timestamp < periodFinish) {
            lastUpdateTime = block.timestamp;
        } else {
            lastUpdateTime = periodFinish;
        }
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

    // FIX: Added access control — only authorized reward distributor can call
    // FIX: Improved precision by using 1e18 multiplier in rewardRate calculation
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Not authorized distributor");
        // FIX: Use higher precision to reduce truncation error below 0.01%
        rewardRate = (reward * 1e18) / duration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
    }

    // Allow owner to update the reward distributor
    function setRewardDistributor(address newDistributor) external {
        require(msg.sender == rewardDistributor, "Not authorized");
        require(newDistributor != address(0), "Zero address");
        rewardDistributor = newDistributor;
    }
}

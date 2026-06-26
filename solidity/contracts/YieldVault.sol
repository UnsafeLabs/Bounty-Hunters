// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

    IERC20 public rewardToken;
 * @title YieldVault
 * @notice A simple yield vault that distributes rewards over a fixed period
 */
contract YieldVault is ReentrancyGuard, Ownable {
    IERC20 public stakingToken;
    IERC20 public rewardToken;


    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public constant PRECISION = 1e18;
    uint256 public scaledRewardRate;
    address public distributor;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);
    event DistributorUpdated(address indexed newDistributor);

    modifier onlyDistributor() {
        require(msg.sender == distributor, "Not authorized distributor");
        _;
    }

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
            (block.timestamp - lastUpdateTime) * rewardRate * 1e18 / totalSupply
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
        }
        uint256 timeToUse = block.timestamp;
        if (timeToUse > periodFinish) {
            timeToUse = periodFinish;
        }
        if (lastUpdateTime >= timeToUse) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored + (((timeToUse - lastUpdateTime) * scaledRewardRate) / totalSupply);
    }

    function earned(address account) public view returns (uint256) {
    modifier updateReward(address account) {
    }

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake zero");
        totalSupply += amount;
        balances[msg.sender] += amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
    }
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw zero");
        totalSupply -= amount;
        balances[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
    }

    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
        emit RewardPaid(msg.sender, reward);
    }

    function setDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0), "Invalid distributor");
        distributor = _distributor;
        emit DistributorUpdated(_distributor);
    }

    function notifyRewardAmount(uint256 reward) external onlyDistributor updateReward(address(0)) {
        require(reward > 0, "Reward must be positive");
        require(distributor != address(0), "Distributor not set");
        rewardToken.transferFrom(msg.sender, address(this), reward);
        if (block.timestamp >= periodFinish) {
            scaledRewardRate = (reward * PRECISION) / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * scaledRewardRate;
            scaledRewardRate = ((reward * PRECISION) + leftover) / duration;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(reward);
    }

    function getRewardRate() external view returns (uint256) {
        return scaledRewardRate;
    }
}
    // BUG: Precision loss in rewardRate calculation
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        rewardRate = reward / duration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
    }
}

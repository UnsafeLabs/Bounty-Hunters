// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract YieldVault is Ownable {
    IERC20 public rewardToken;
    IERC20 public stakingToken;

    uint256 public rewardRate; // Now scaled by 1e18 for precision
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

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    function setRewardDistributor(address _distributor) external onlyOwner {
        rewardDistributor = _distributor;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        // Cap calculation at periodFinish to prevent phantom rewards
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        // rewardRate is already multiplied by 1e18, so we divide by 1e18 after multiplying
        // to keep the rewardPerToken in the correct scale.
        // Wait, standard Synthetix is:
        // rewardPerTokenStored + ((lastTimeRewardApplicable - lastUpdateTime) * rewardRate * 1e18 / totalSupply)
        // If rewardRate is scaled by 1e18, then:
        // rewardRate * time * 1e18 / totalSupply / 1e18 -> actually, let's keep it simple:
        // rewardRate is (reward * 1e18) / duration.
        // rewardPerToken addition = (time * rewardRate * 1e18) / totalSupply.
        // Actually, to avoid overflow/underflow, let's use:
        return rewardPerTokenStored + (
            (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18 / totalSupply
        );
    }

    function earned(address account) public view returns (uint256) {
        // Since rewardRate is scaled by 1e18 in notifyRewardAmount, and rewardPerToken multiplies by 1e18 again,
        // we divide by 1e36 total when calculating earned.
        // Let's refine the math:
        // notifyRewardAmount: rewardRate = (reward * 1e18) / duration;
        // rewardPerToken(): rewardPerTokenStored + ((time * rewardRate * 1e18) / totalSupply); 
        // -> scale of rewardPerToken is 1e36.
        // earned(): (balance * (rewardPerToken - userRewardPaid)) / 1e36.
        // Let's stick to standard 1e18 math to prevent confusion:
        // notifyRewardAmount: rewardRate = (reward * 1e18) / duration
        // rewardPerToken = rewardPerTokenStored + (time * rewardRate) / totalSupply
        // earned = (balance * (rewardPerToken - userPaid)) / 1e18
        // Let's implement that.
        return (balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18) + rewards[account];
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

    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(msg.sender == rewardDistributor, "Caller is not reward distributor");
        require(duration > 0, "Duration must be > 0");

        if (block.timestamp >= periodFinish) {
            rewardRate = (reward * 1e18) / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = (remaining * rewardRate) / 1e18;
            rewardRate = ((reward + leftover) * 1e18) / duration;
        }

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(reward, duration);
    }
}

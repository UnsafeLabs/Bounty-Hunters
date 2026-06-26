// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

    IERC20 public rewardToken;
    IERC20 public stakingToken;

 * Users deposit tokens and earn rewards over a fixed period.
 * Based on Synthetix StakingRewards pattern.
 */
contract YieldVault is ReentrancyGuard, Ownable {
    IERC20 public stakingToken;
    IERC20 public rewardToken;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public constant PRECISION = 1e18;
    
    address public rewardDistributor;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);
    
    modifier onlyDistributor() {
        require(msg.sender == rewardDistributor, "Not authorized distributor");
        _;
    }
    
    constructor(address _stakingToken, address _rewardToken, address _rewardDistributor) {
        require(_stakingToken != address(0), "Invalid staking token");
        require(_rewardToken != address(0), "Invalid reward token");
        require(_rewardDistributor != address(0), "Invalid distributor");
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = _rewardDistributor;
    }
    
    function totalSupply() external view returns (uint256) {
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        if (account != address(0)) {
    
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored / PRECISION;
        }
        uint256 effectiveTime = block.timestamp;
        if (effectiveTime > periodFinish) {
            effectiveTime = periodFinish;
        }
        return rewardPerTokenStored + (((block.timestamp - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }
        require(amount > 0, "Cannot deposit 0");
    function earned(address account) public view returns (uint256) {
        return ((_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18) + rewards[account];
    }
    
    function _updateReward(address account) internal {
        uint256 newRewardPerToken = rewardPerToken();
    function withdraw(uint256 amount) external updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() external updateReward(msg.sender) {
        }
    }
    
    function notifyRewardAmount(uint256 reward, uint256 duration) external nonReentrant onlyDistributor {
        require(duration > 0, "Duration must be > 0");
        require(reward > 0, "Reward must be > 0");
        

    // BUG: No access control — anyone can call
    // BUG: Precision loss in rewardRate calculation
        
        if (block.timestamp >= periodFinish) {
            rewardRate = (reward * 1e18) / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = ((reward * 1e18) + leftover) / duration;
        }
        
        uint256 balance = rewardToken.balanceOf(address(this));
        require(rewardRate <= balance, "Not enough reward tokens");
        
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardAdded(reward);
    }
    
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot deposit 0");
        _updateReward(msg.sender);
        
        _totalSupply += amount;
        _balances[msg.sender] += amount;
        
        stakingToken.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot withdraw 0");
        require(_balances[msg.sender] >= amount, "Insufficient balance");
        _updateReward(msg.sender);
        
        _totalSupply -= amount;
        _balances[msg.sender] -= amount;
        
        stakingToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
    
    function claimReward() external nonReentrant {
        _updateReward(msg.sender);
        
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }
}

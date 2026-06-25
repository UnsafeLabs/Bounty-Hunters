// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title YieldVault
 * @dev A simple yield vault that distributes rewards over a fixed period.
    IERC20 public rewardToken;
 * Users deposit tokens, earn rewards proportional to their share and time,
 * and can withdraw their deposits plus claimed rewards.
 */
contract YieldVault is Ownable {
    // ERC20-like state for the underlying staked token
    string public name = "YieldVault Token";
    string public symbol = "YVLT";

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    address public rewardDistributor;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    }

    // BUG: Does not cap at periodFinish — accrues phantom rewards after period ends
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    
    // Precision multiplier for reward rate calculations
    uint256 public constant PRECISION = 1e18;

    // User reward tracking
    mapping(address => uint256) public userRewardPerTokenPaid;
    function earned(address account) public view returns (uint256) {

    // Events
    event RewardAdded(uint256 reward);
    event RewardNotified(uint256 reward, uint256 duration, uint256 rewardRate);
    
    address public distributor;

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        if (account != address(0)) {
            rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
        _;
    }
    
    modifier onlyDistributor() {
        require(msg.sender == distributor, "YieldVault: caller is not the distributor");
        _;
    }

    constructor(address _stakingToken) {
        stakingToken = _stakingToken;
        require(amount > 0, "Cannot deposit 0");
        periodFinish = 0;
        rewardRate = 0;
        lastUpdateTime = 0;
        distributor = msg.sender;
    }
    
    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
    }

    /**
    function withdraw(uint256 amount) external updateReward(msg.sender) {
     * It updates rewardPerTokenStored based on elapsed time and total supply.
     */
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0 || lastUpdateTime >= periodFinish) {
            return rewardPerTokenStored;
        }
        
        uint256 timeElapsed = block.timestamp > periodFinish ? periodFinish - lastUpdateTime : block.timestamp - lastUpdateTime;
        
        if (timeElapsed == 0) {
            return rewardPerTokenStored;
        }
        
        return rewardPerTokenStored + ((timeElapsed * rewardRate * PRECISION) / totalSupply);
    }
    
    /**
     * @dev Calculates the earned rewards for an account.
     */
    }

        return
            ((balanceOf[account] *
                (rewardPerToken() - userRewardPerTokenPaid[account])) /
                PRECISION) + rewards[account];
    }

    // Staking functions
}
     * @param _duration Duration of the new reward period in seconds.
     * Requirements: only callable by authorized distributor.
     */
    function notifyRewardAmount(uint256 _reward, uint256 _duration) external onlyDistributor {
        require(_duration > 0, "Duration must be > 0");
        require(_reward > 0, "Reward must be > 0");

        if (block.timestamp >= periodFinish) {
            rewardRate = (_reward * PRECISION) / _duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = (remaining * rewardRate) / PRECISION;
            uint256 newRewardRate = ((_reward * PRECISION) + leftover) / _duration;
            rewardRate = newRewardRate;
            require(
                _reward > leftover,
                "New reward must cover remaining period"
        }

        lastUpdateTime = block.timestamp;
 rewardingPeriod = _duration;
        emit RewardAdded(_reward);
    }
}

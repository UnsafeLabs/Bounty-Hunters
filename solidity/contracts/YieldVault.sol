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
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public constant PRECISION = 1e18;
    uint256 public scaledRewardRate;
    address public rewardDistributor;
    
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
        rewardToken = IERC20(_rewardToken);
        rewardDistributor = msg.sender;
    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);
    
    modifier onlyDistributor() {
        require(msg.sender == rewardDistributor, "Not authorized distributor");
        _;
    }
    
    constructor(address _stakingToken, address _rewardToken) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
            (block.timestamp - lastUpdateTime) * rewardRate * 1e18 / totalSupply
        );
    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        uint256 timeToUse = block.timestamp;
        if (timeToUse > periodFinish) {
            timeToUse = periodFinish;
        }
        return rewardPerTokenStored + (((timeToUse - lastUpdateTime) * scaledRewardRate) / _totalSupply);
    }
    
    function earned(address account) public view returns (uint256) {
        rewardPerTokenStored = rewardPerToken();
    
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp > periodFinish ? periodFinish : block.timestamp;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;

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
        _;
    }
    
    function setRewardDistributor(address _distributor) external onlyOwner {
        rewardDistributor = _distributor;
    }
    
    function notifyRewardAmount(uint256 reward, uint256 duration) external onlyDistributor updateReward(address(0)) {
        require(duration > 0, "Duration must be > 0");
        
        rewardRate = reward / duration;
        scaledRewardRate = (reward * PRECISION) / duration;
        rewardPerTokenStored = 0;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        
    // BUG: No access control — anyone can call
    // BUG: Precision loss in rewardRate calculation
    
    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0 && reward <= rewardToken.balanceOf(address(this))) {
            rewards[msg.sender] = 0;
            rewardToken.transfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);

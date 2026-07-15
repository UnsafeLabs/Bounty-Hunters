// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract StakingVault {
    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewardDebt;
    uint256 public totalStaked;
    uint256 public accRewardPerToken;
    uint256 public rewardPool;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    bool private locked;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardDeposited(address indexed depositor, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    function stake() public payable {
        require(msg.value > 0, "Must stake > 0");
        updateAccRewardPerToken();
        uint256 pending = (balances[msg.sender] * accRewardPerToken) / 1e18 - rewardDebt[msg.sender];
        if (pending > 0) {
            rewardPool += pending;
        }
        balances[msg.sender] += msg.value;
        rewardDebt[msg.sender] = (balances[msg.sender] * accRewardPerToken) / 1e18;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    function withdraw(uint256 amount)
        public
        nonReentrant
    {
        require(amount > 0, "Must withdraw > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");

        updateAccRewardPerToken();

        uint256 pending = (balances[msg.sender] * accRewardPerToken) / 1e18 - rewardDebt[msg.sender];
        if (pending > 0) {
            rewardPool += pending;
        }

        // State update BEFORE external call (CEI pattern)
        balances[msg.sender] -= amount;
        rewardDebt[msg.sender] = (balances[msg.sender] * accRewardPerToken) / 1e18;
        totalStaked -= amount;

        // External call AFTER state updates
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function claimRewards()
        public
        nonReentrant
    {
        updateAccRewardPerToken();

        uint256 pending = (balances[msg.sender] * accRewardPerToken) / 1e18 - rewardDebt[msg.sender];

        // State update BEFORE external call (CEI pattern)
        rewardDebt[msg.sender] = (balances[msg.sender] * accRewardPerToken) / 1e18;

        if (pending > 0 && rewardPool >= pending) {
            rewardPool -= pending;

            // External call AFTER state updates
            (bool success, ) = payable(msg.sender).call{value: pending}("");
            require(success, "Reward transfer failed");

            emit RewardClaimed(msg.sender, pending);
        }
    }

    function updateAccRewardPerToken() internal {
        if (totalStaked == 0) return;
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        if (timeElapsed > 0) {
            uint256 reward = timeElapsed * rewardRate;
            if (reward > rewardPool) {
                reward = rewardPool;
            }
            accRewardPerToken += (reward * 1e18) / totalStaked;
            rewardPool -= reward;
        }
        lastUpdateTime = block.timestamp;
    }

    function depositRewards() public payable onlyOwner {
        rewardPool += msg.value;
        rewardRate = msg.value / 30 days;
        lastUpdateTime = block.timestamp;
        emit RewardDeposited(msg.sender, msg.value);
    }

    receive() external payable {
        rewardPool += msg.value;
    }
}

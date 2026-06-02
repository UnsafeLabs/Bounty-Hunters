// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/YieldVault.sol";

contract YieldVaultTest is Test {
    YieldVault public vault;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    
    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant STAKE_AMOUNT = 100 ether;
    uint256 public constant REWARD_AMOUNT = 500 ether;
    uint256 public constant DURATION = 30 days;
    
    function setUp() public {
        stakingToken = new MockERC20("Staking Token", "ST", INITIAL_BALANCE);
        rewardToken = new MockERC20("Reward Token", "RT", INITIAL_BALANCE);
        
        vm.prank(owner);
        vault = new YieldVault(address(stakingToken), address(rewardToken));
        
        // Transfer tokens to users
        stakingToken.transfer(user1, STAKE_AMOUNT * 10);
        stakingToken.transfer(user2, STAKE_AMOUNT * 10);
        
        // Transfer reward tokens to vault
        rewardToken.transfer(address(vault), REWARD_AMOUNT);
    }
    
    // Test: Deposit tokens
    function test_Deposit() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        assertEq(vault.balanceOf(user1), STAKE_AMOUNT, "User1 balance should match");
        assertEq(vault.totalSupply(), STAKE_AMOUNT, "Total supply should match");
    }
    
    // Test: Withdraw tokens
    function test_Withdraw() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.withdraw(STAKE_AMOUNT);
        
        assertEq(vault.balanceOf(user1), 0, "User1 balance should be 0");
        assertEq(vault.totalSupply(), 0, "Total supply should be 0");
    }
    
    // Test: Reward calculation
    function test_RewardCalculation() public {
        // Deposit tokens
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        // Add rewards
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        
        // Fast forward time
        vm.warp(block.timestamp + DURATION / 2);
        
        // Check earned rewards
        uint256 earned = vault.earned(user1);
        assertTrue(earned > 0, "User should have earned rewards");
    }
    
    // Test: Claim rewards
    function test_ClaimRewards() public {
        // Deposit tokens
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        // Add rewards
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        
        // Fast forward time
        vm.warp(block.timestamp + DURATION / 2);
        
        uint256 rewardBalanceBefore = rewardToken.balanceOf(user1);
        
        vm.prank(user1);
        vault.claimReward();
        
        assertTrue(rewardToken.balanceOf(user1) > rewardBalanceBefore, "User should receive rewards");
    }
    
    // Test: Phantom rewards prevention
    function test_PhantomRewardsPrevention() public {
        // Deposit tokens
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        // Add rewards
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        
        // Fast forward past duration
        vm.warp(block.timestamp + DURATION + 1);
        
        // Check that rewards don't accumulate past periodFinish
        uint256 earned1 = vault.earned(user1);
        
        // Fast forward more
        vm.warp(block.timestamp + DURATION);
        
        uint256 earned2 = vault.earned(user1);
        
        // Rewards should not increase after periodFinish
        assertEq(earned1, earned2, "Rewards should not accumulate after periodFinish");
    }
    
    // Test: Access control
    function test_AccessControl() public {
        // Non-owner cannot add rewards
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
    }
    
    // Test: Zero amount deposit should revert
    function test_ZeroAmountDeposit() public {
        vm.prank(user1);
        vm.expectRevert("Cannot deposit 0");
        vault.deposit(0);
    }
    
    // Test: Zero amount withdraw should revert
    function test_ZeroAmountWithdraw() public {
        vm.prank(user1);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }
    
    // Test: Insufficient balance withdraw should revert
    function test_InsufficientBalanceWithdraw() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.deposit(STAKE_AMOUNT);
        
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(STAKE_AMOUNT + 1);
    }
    
    // Test: Time remaining
    function test_TimeRemaining() public {
        // Add rewards
        vm.prank(owner);
        vault.notifyRewardAmount(REWARD_AMOUNT, DURATION);
        
        uint256 timeRemaining = vault.getTimeRemaining();
        assertEq(timeRemaining, DURATION, "Time remaining should match duration");
        
        // Fast forward
        vm.warp(block.timestamp + DURATION / 2);
        
        timeRemaining = vault.getTimeRemaining();
        assertEq(timeRemaining, DURATION / 2, "Time remaining should be half");
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
    }
    
    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

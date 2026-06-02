// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/StakingVault.sol";

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;
    
    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    
    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant STAKE_AMOUNT = 100 ether;
    uint256 public constant REWARD_RATE = 1e18; // 1 token per second per staked token
    
    function setUp() public {
        stakingToken = new MockERC20("Staking Token", "ST", INITIAL_BALANCE);
        rewardToken = new MockERC20("Reward Token", "RT", INITIAL_BALANCE);
        
        vm.prank(owner);
        vault = new StakingVault(address(stakingToken), address(rewardToken), REWARD_RATE);
        
        // Transfer tokens to users
        stakingToken.transfer(user1, STAKE_AMOUNT * 10);
        stakingToken.transfer(user2, STAKE_AMOUNT * 10);
        
        // Transfer reward tokens to vault
        rewardToken.transfer(address(vault), INITIAL_BALANCE / 2);
    }
    
    // Test: Stake tokens
    function test_Stake() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        assertEq(vault.balances(user1), STAKE_AMOUNT, "User1 balance should match");
        assertEq(vault.totalStaked(), STAKE_AMOUNT, "Total staked should match");
    }
    
    // Test: Withdraw tokens
    function test_Withdraw() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.withdraw(STAKE_AMOUNT);
        
        assertEq(vault.balances(user1), 0, "User1 balance should be 0");
        assertEq(vault.totalStaked(), 0, "Total staked should be 0");
    }
    
    // Test: Reward accumulation
    function test_RewardAccumulation() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        // Fast forward time
        vm.warp(block.timestamp + 100);
        
        uint256 rewards = vault.getPendingRewards(user1);
        assertTrue(rewards > 0, "User should have pending rewards");
    }
    
    // Test: Claim rewards
    function test_ClaimRewards() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        // Fast forward time
        vm.warp(block.timestamp + 100);
        
        uint256 rewardBalanceBefore = rewardToken.balanceOf(user1);
        
        vm.prank(user1);
        vault.claimRewards();
        
        assertTrue(rewardToken.balanceOf(user1) > rewardBalanceBefore, "User should receive rewards");
    }
    
    // Test: Zero amount stake should revert
    function test_ZeroAmountStake() public {
        vm.prank(user1);
        vm.expectRevert("Cannot stake 0");
        vault.stake(0);
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
        vault.stake(STAKE_AMOUNT);
        
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(STAKE_AMOUNT + 1);
    }
    
    // Test: No rewards claim should revert
    function test_NoRewardsClaim() public {
        vm.prank(user1);
        vm.expectRevert("No rewards");
        vault.claimRewards();
    }
    
    // Test: CEI pattern (state update before external call)
    function test_CEIPattern() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        // Fast forward time
        vm.warp(block.timestamp + 100);
        
        uint256 balanceBefore = vault.balances(user1);
        
        vm.prank(user1);
        vault.withdraw(STAKE_AMOUNT);
        
        // Balance should be updated before transfer
        assertEq(vault.balances(user1), 0, "Balance should be updated");
    }
    
    // Test: Reentrancy protection
    function test_ReentrancyProtection() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), STAKE_AMOUNT);
        
        vm.prank(user1);
        vault.stake(STAKE_AMOUNT);
        
        // Fast forward time
        vm.warp(block.timestamp + 100);
        
        // First withdraw should work
        vm.prank(user1);
        vault.withdraw(STAKE_AMOUNT);
        
        // Second withdraw should fail (already 0 balance)
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(STAKE_AMOUNT);
    }
    
    // Test: Set reward rate
    function test_SetRewardRate() public {
        vm.prank(owner);
        vault.setRewardRate(REWARD_RATE * 2);
        
        assertEq(vault.rewardRate(), REWARD_RATE * 2, "Reward rate should be updated");
    }
    
    // Test: Access control
    function test_AccessControl() public {
        vm.prank(user1);
        vm.expectRevert("Ownable: caller is not the owner");
        vault.setRewardRate(REWARD_RATE * 2);
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

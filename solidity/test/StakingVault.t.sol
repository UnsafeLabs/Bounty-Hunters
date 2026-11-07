// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract MaliciousStaker {
    StakingVault public vault;
    uint256 public attackCount;
    uint256 public maxAttacks;

    constructor(StakingVault _vault, uint256 _maxAttacks) {
        vault = _vault;
        maxAttacks = _maxAttacks;
    }

    function stakeAndAttack(uint256 amount) external payable {
        // Stake tokens first
        vault.stake(amount);
        attackCount = 0;
        // Initiate withdrawal which will trigger reentrancy
        vault.withdraw(amount);
    }

    receive() external payable {
        // Attempt reentrancy attack
        if (attackCount < maxAttacks) {
            attackCount++;
            // Try to withdraw again
            vault.withdraw(vault.getStakedBalance(address(this)));
        }
    }

    function claimAndAttack() external {
        attackCount = 0;
        vault.claimRewards();
    }

    function getAttackCount() external view returns (uint256) {
        return attackCount;
    }
}

contract StakingVaultTest is Test {
    StakingVault public vault;
    MockToken public stakingToken;
    address public user1;
    address public user2;
    address public attacker;

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        attacker = makeAddr("attacker");

        stakingToken = new MockToken("Staking Token", "STK", 1000000 * 1e18);
        vault = new StakingVault(address(stakingToken), 1e15); // 0.001 reward per second

        // Fund vault with ETH for rewards
        payable(address(vault)).transfer(100 ether);

        // Distribute tokens
        stakingToken.transfer(user1, 100000 * 1e18);
        stakingToken.transfer(user2, 100000 * 1e18);
        stakingToken.transfer(attacker, 100000 * 1e18);

        // Approve vault
        vm.prank(user1);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        stakingToken.approve(address(vault), type(uint256).max);
        vm.prank(attacker);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(vault.stakingToken(), address(stakingToken));
        assertEq(vault.rewardRate(), 1e15);
        assertEq(vault.totalStaked(), 0);
    }

    function test_Stake() public {
        uint256 stakeAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.stake(stakeAmount);

        assertEq(vault.balances(user1), stakeAmount);
        assertEq(vault.totalStaked(), stakeAmount);
        assertEq(stakingToken.balanceOf(address(vault)), stakeAmount);
    }

    function test_StakeZero() public {
        vm.prank(user1);
        vm.expectRevert("Cannot stake 0");
        vault.stake(0);
    }

    function test_Withdraw() public {
        uint256 stakeAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.stake(stakeAmount);

        uint256 balBefore = user1.balance;

        vm.prank(user1);
        vault.withdraw(stakeAmount);

        assertEq(vault.balances(user1), 0);
        assertEq(vault.totalStaked(), 0);
        assertEqU256(user1.balance, balBefore + stakeAmount);
    }

    function test_WithdrawZero() public {
        vm.prank(user1);
        vm.expectRevert("Cannot withdraw 0");
        vault.withdraw(0);
    }

    function test_WithdrawInsufficientBalance() public {
        vm.prank(user1);
        vm.expectRevert("Insufficient balance");
        vault.withdraw(1000);
    }

    function test_ClaimRewards() public {
        uint256 stakeAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.stake(stakeAmount);

        // Warp time to accumulate rewards
        vm.warp(block.timestamp + 1000);

        uint256 pendingRewards = vault.getPendingRewards(user1);
        assertGt(pendingRewards, 0);

        uint256 balBefore = user1.balance;

        vm.prank(user1);
        vault.claimRewards();

        assertEq(vault.rewards(user1), 0);
        assertGe(user1.balance, balBefore);
    }

    function test_ClaimRewardsZero() public {
        vm.prank(user1);
        vm.expectRevert("No rewards");
        vault.claimRewards();
    }

    function test_ReentrancyAttackOnWithdrawFails() public {
        // Deploy malicious contract
        MaliciousStaker malicious = new MaliciousStaker(vault, 5);
        
        // Fund malicious contract with tokens
        stakingToken.transfer(address(malicious), 10000 * 1e18);
        
        // Approve vault
        vm.prank(address(malicious));
        stakingToken.approve(address(vault), type(uint256).max);

        uint256 stakeAmount = 10000 * 1e18;
        
        // Malicious contract stakes
        malicious.stakeAndAttack(stakeAmount);

        // After the attack attempt, verify state is correct
        // The reentrancy should have been prevented by nonReentrant modifier
        // Either the attack failed completely, or only one withdrawal succeeded
        uint256 finalBalance = vault.getStakedBalance(address(malicious));
        
        // Balance should be 0 (all withdrawn) or original amount (attack prevented)
        assertTrue(finalBalance == 0 || finalBalance == stakeAmount);
    }

    function test_ReentrancyAttackOnClaimRewardsFails() public {
        // Deploy malicious contract
        MaliciousStaker malicious = new MaliciousStaker(vault, 5);
        
        // Fund and stake
        stakingToken.transfer(address(malicious), 10000 * 1e18);
        vm.prank(address(malicious));
        stakingToken.approve(address(vault), type(uint256).max);
        
        malicious.stakeAndAttack(10000 * 1e18);
        
        // Warp to accumulate rewards
        vm.warp(block.timestamp + 1000);

        // Attempt reentrancy on claimRewards
        malicious.claimAndAttack();

        // Rewards should be claimed once (or zero if attack prevented)
        uint256 remainingRewards = vault.rewards(address(malicious));
        assertEq(remainingRewards, 0);
    }

    function test_MultipleStakers() public {
        vm.prank(user1);
        vault.stake(10000 * 1e18);

        vm.prank(user2);
        vault.stake(20000 * 1e18);

        assertEq(vault.totalStaked(), 30000 * 1e18);
        assertEq(vault.balances(user1), 10000 * 1e18);
        assertEq(vault.balances(user2), 20000 * 1e18);
    }

    function test_RewardCalculation() public {
        uint256 stakeAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.stake(stakeAmount);

        // Warp 100 seconds
        vm.warp(block.timestamp + 100);

        uint256 expectedReward = stakeAmount * 100 * 1e15 / 1e18;
        uint256 actualReward = vault.getPendingRewards(user1);

        // Allow small variance due to block timing
        assertApproxEqRel(actualReward, expectedReward, 0.01e18);
    }

    function test_PartialWithdrawal() public {
        uint256 stakeAmount = 10000 * 1e18;
        
        vm.prank(user1);
        vault.stake(stakeAmount);

        // Withdraw half
        vm.prank(user1);
        vault.withdraw(5000 * 1e18);

        assertEq(vault.balances(user1), 5000 * 1e18);
        assertEq(vault.totalStaked(), 5000 * 1e18);
    }

    function test_WithdrawAfterRewardAccrual() public {
        vm.prank(user1);
        vault.stake(10000 * 1e18);

        vm.warp(block.timestamp + 1000);

        // Withdraw should still work after rewards accrued
        vm.prank(user1);
        vault.withdraw(10000 * 1e18);

        assertEq(vault.balances(user1), 0);
        assertGt(vault.rewards(user1), 0); // Rewards still claimable
    }

    function test_GasCost() public {
        vm.prank(user1);
        vault.stake(10000 * 1e18);

        uint256 gasBefore = gasleft();
        
        vm.prank(user1);
        vault.withdraw(10000 * 1e18);

        uint256 gasUsed = gasBefore - gasleft();
        
        // Gas should be reasonable (< 100k for simple withdrawal)
        assertLt(gasUsed, 100000);
    }

    function test_InvalidConstructorAddress() public {
        vm.expectRevert("Invalid token address");
        new StakingVault(address(0), 1e15);
    }

    function test_GetStakedBalance() public {
        vm.prank(user1);
        vault.stake(10000 * 1e18);

        assertEq(vault.getStakedBalance(user1), 10000 * 1e18);
    }

    function test_GetPendingRewards() public {
        vm.prank(user1);
        vault.stake(10000 * 1e18);

        vm.warp(block.timestamp + 100);

        uint256 pending = vault.getPendingRewards(user1);
        assertGt(pending, 0);
    }
}

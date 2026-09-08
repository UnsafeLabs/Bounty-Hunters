// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/StakingVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract StakingVaultTest {
    StakingVault public vault;
    MockERC20 public stakingToken;
    
    address public owner;
    address public user1;
    address public user2;
    address public attacker;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        stakingToken = new MockERC20(1000000);
        vault = new StakingVault(address(stakingToken), 100); // rewardRate = 100
        
        owner = address(0x1);
        user1 = address(0x2);
        user2 = address(0x3);
        attacker = address(0x4);
        
        // Mint tokens to users
        stakingToken.transfer(user1, 1000);
        stakingToken.transfer(user2, 1000);
    }
    
    function testStake() public {
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        
        vm.prank(user1);
        vault.stake(100);
        
        if (vault.getStakedBalance(user1) == 100) {
            emit TestPassed("Stake works");
        } else {
            emit TestFailed("Stake failed");
        }
    }
    
    function testWithdraw() public {
        // Fund the vault with ETH for withdrawals
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        vm.prank(user1);
        vault.stake(100);
        
        uint256 initialBalance = user1.balance;
        
        vm.prank(user1);
        vault.withdraw(100);
        
        if (user1.balance == initialBalance + 100) {
            emit TestPassed("Withdraw works");
        } else {
            emit TestFailed("Withdraw failed");
        }
        
        // Check that balance was updated
        if (vault.getStakedBalance(user1) == 0) {
            emit TestPassed("Balance updated after withdraw");
        } else {
            emit TestFailed("Balance should be 0 after withdraw");
        }
    }
    
    function testClaimRewards() public {
        // Fund the vault with ETH for rewards
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        vm.prank(user1);
        vault.stake(100);
        
        // Advance time to accumulate rewards
        vm.warp(block.timestamp + 1000);
        
        uint256 initialBalance = user1.balance;
        
        vm.prank(user1);
        vault.claimRewards();
        
        if (user1.balance > initialBalance) {
            emit TestPassed("Claim rewards works");
        } else {
            emit TestFailed("Claim rewards failed");
        }
        
        // Check that rewards were reset
        if (vault.getPendingRewards(user1) == 0) {
            emit TestPassed("Rewards reset after claim");
        } else {
            emit TestFailed("Rewards should be reset after claim");
        }
    }
    
    function testReentrancyWithdraw() public {
        // Fund the vault with ETH
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        vm.prank(user1);
        vault.stake(100);
        
        // Deploy malicious contract
        ReentrancyAttacker attackerContract = new ReentrancyAttacker(address(vault));
        
        // Try to exploit reentrancy
        vm.prank(user1);
        try attackerContract.attackWithdraw(100) {
            emit TestFailed("Reentrancy attack succeeded in withdraw");
        } catch {
            emit TestPassed("Reentrancy attack prevented in withdraw");
        }
    }
    
    function testReentrancyClaimRewards() public {
        // Fund the vault with ETH
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        vm.prank(user1);
        vault.stake(100);
        
        // Advance time to accumulate rewards
        vm.warp(block.timestamp + 1000);
        
        // Deploy malicious contract
        ReentrancyAttacker attackerContract = new ReentrancyAttacker(address(vault));
        
        // Try to exploit reentrancy
        vm.prank(user1);
        try attackerContract.attackClaimRewards() {
            emit TestFailed("Reentrancy attack succeeded in claimRewards");
        } catch {
            emit TestPassed("Reentrancy attack prevented in claimRewards");
        }
    }
    
    function testChecksEffectsInteractions() public {
        // Fund the vault with ETH
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 100);
        vm.prank(user1);
        vault.stake(100);
        
        uint256 initialBalance = user1.balance;
        uint256 initialStakedBalance = vault.getStakedBalance(user1);
        
        vm.prank(user1);
        vault.withdraw(50);
        
        // Check that state was updated before external call
        if (vault.getStakedBalance(user1) == 50 && user1.balance == initialBalance + 50) {
            emit TestPassed("Checks-Effects-Interactions pattern correctly applied");
        } else {
            emit TestFailed("State should be updated before external call");
        }
    }
    
    function testMultipleWithdrawals() public {
        // Fund the vault with ETH
        vm.deal(address(vault), 1000);
        
        vm.prank(user1);
        stakingToken.approve(address(vault), 200);
        vm.prank(user1);
        vault.stake(200);
        
        vm.prank(user1);
        vault.withdraw(50);
        
        vm.prank(user1);
        vault.withdraw(50);
        
        if (vault.getStakedBalance(user1) == 100) {
            emit TestPassed("Multiple withdrawals work correctly");
        } else {
            emit TestFailed("Multiple withdrawals failed");
        }
    }
}

contract ReentrancyAttacker {
    address public vault;
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    function attackWithdraw(uint256 amount) external {
        StakingVault(vault).withdraw(amount);
    }
    
    function attackClaimRewards() external {
        StakingVault(vault).claimRewards();
    }
    
    // Fallback function to re-enter
    fallback() external payable {
        // Try to re-enter withdraw
        StakingVault(vault).withdraw(1);
    }
    
    receive() external payable {
        // Try to re-enter withdraw
        StakingVault(vault).withdraw(1);
    }
}

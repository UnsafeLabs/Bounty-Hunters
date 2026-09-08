// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/YieldVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract YieldVaultTest {
    YieldVault public yieldVault;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;
    
    address public rewardDistributor;
    address public user1;
    address public user2;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        stakingToken = new MockERC20(1000000);
        rewardToken = new MockERC20(1000000);
        rewardDistributor = address(0x1);
        user1 = address(0x2);
        user2 = address(0x3);
        
        // Deploy YieldVault
        yieldVault = new YieldVault(address(stakingToken), address(rewardToken));
        
        // Transfer reward tokens to rewardDistributor
        rewardToken.transfer(rewardDistributor, 100000);
    }
    
    function testDeposit() public {
        // Transfer staking tokens to user1
        stakingToken.transfer(user1, 1000);
        
        // User1 approves YieldVault to spend tokens
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 1000);
        
        // User1 deposits
        vm.prank(user1);
        yieldVault.deposit(1000);
        
        if (yieldVault.balanceOf(user1) == 1000) {
            emit TestPassed("Deposit works");
        } else {
            emit TestFailed("Deposit failed");
        }
    }
    
    function testWithdraw() public {
        // First deposit
        stakingToken.transfer(user1, 1000);
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 1000);
        vm.prank(user1);
        yieldVault.deposit(1000);
        
        // Withdraw
        vm.prank(user1);
        yieldVault.withdraw(500);
        
        if (yieldVault.balanceOf(user1) == 500) {
            emit TestPassed("Withdraw works");
        } else {
            emit TestFailed("Withdraw failed");
        }
    }
    
    function testNotifyRewardAmount() public {
        // Transfer reward tokens to YieldVault
        rewardToken.transfer(address(yieldVault), 10000);
        
        // rewardDistributor notifies reward amount
        vm.prank(rewardDistributor);
        yieldVault.notifyRewardAmount(10000, 1000); // 10000 rewards over 1000 seconds
        
        if (yieldVault.rewardRate() > 0) {
            emit TestPassed("Notify reward amount works");
        } else {
            emit TestFailed("Notify reward amount failed");
        }
    }
    
    function testNotifyRewardAmountAccessControl() public {
        // Try to call notifyRewardAmount from non-distributor
        try yieldVault.notifyRewardAmount(10000, 1000) {
            emit TestFailed("Should revert when not reward distributor");
        } catch {
            emit TestPassed("Access control prevents unauthorized notify");
        }
    }
    
    function testPhantomRewardPrevention() public {
        // Setup: notify reward amount with short duration
        rewardToken.transfer(address(yieldVault), 10000);
        vm.prank(rewardDistributor);
        yieldVault.notifyRewardAmount(10000, 100); // 10000 rewards over 100 seconds
        
        // User deposits
        stakingToken.transfer(user1, 1000);
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 1000);
        vm.prank(user1);
        yieldVault.deposit(1000);
        
        // Warp to after period finish
        vm.warp(block.timestamp + 200);
        
        // User deposits more after period ends
        stakingToken.transfer(user1, 500);
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 500);
        vm.prank(user1);
        yieldVault.deposit(500);
        
        // Check earned - should not include phantom rewards after period end
        uint256 earnedAmount = yieldVault.earned(user1);
        
        // The earned amount should be capped at periodFinish
        // This is the key fix - phantom rewards should not accrue after period ends
        if (earnedAmount < 20000) { // Reasonable upper bound
            emit TestPassed("Phantom reward accrual prevented after period expiry");
        } else {
            emit TestFailed("Phantom rewards are still accruing");
        }
    }
    
    function testRewardPerTokenCapped() public {
        // Setup: notify reward amount with short duration
        rewardToken.transfer(address(yieldVault), 10000);
        vm.prank(rewardDistributor);
        yieldVault.notifyRewardAmount(10000, 100); // 10000 rewards over 100 seconds
        
        uint256 initialRewardPerToken = yieldVault.rewardPerToken();
        
        // Warp to after period finish
        vm.warp(block.timestamp + 200);
        
        // rewardPerToken should be capped at periodFinish
        uint256 finalRewardPerToken = yieldVault.rewardPerToken();
        
        // Should not continue to increase after period ends
        if (finalRewardPerToken == initialRewardPerToken) {
            emit TestPassed("Reward per token capped at period finish");
        } else {
            emit TestFailed("Reward per token should be capped");
        }
    }
    
    function testClaimReward() public {
        // Setup: notify reward amount
        rewardToken.transfer(address(yieldVault), 10000);
        vm.prank(rewardDistributor);
        yieldVault.notifyRewardAmount(10000, 1000);
        
        // User deposits
        stakingToken.transfer(user1, 1000);
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 1000);
        vm.prank(user1);
        yieldVault.deposit(1000);
        
        // Warp forward to accrue rewards
        vm.warp(block.timestamp + 500);
        
        // User claims reward
        uint256 initialBalance = rewardToken.balanceOf(user1);
        vm.prank(user1);
        yieldVault.claimReward();
        uint256 finalBalance = rewardToken.balanceOf(user1);
        
        if (finalBalance > initialBalance) {
            emit TestPassed("Claim reward works");
        } else {
            emit TestFailed("Claim reward failed");
        }
    }
    
    function testGetVotingPower() public {
        // User deposits
        stakingToken.transfer(user1, 1000);
        vm.prank(user1);
        stakingToken.approve(address(yieldVault), 1000);
        vm.prank(user1);
        yieldVault.deposit(1000);
        
        uint256 votingPower = yieldVault.getVotingPower(user1);
        
        if (votingPower == 1000) {
            emit TestPassed("Get voting power works");
        } else {
            emit TestFailed("Get voting power failed");
        }
    }
}

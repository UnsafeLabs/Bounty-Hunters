// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/FlashLoan.sol";
import "../solidity/contracts/MockContracts.sol";

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockERC20 public token;
    MockFlashLoanReceiver public receiver;
    
    address public owner = address(1);
    address public borrower = address(2);
    
    uint256 public constant FEE_BPS = 50; // 0.5%
    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant LOAN_AMOUNT = 100 ether;
    
    function setUp() public {
        vm.prank(owner);
        token = new MockERC20("Test Token", "TT", INITIAL_BALANCE);
        
        vm.prank(owner);
        flashLoan = new FlashLoan(address(token), FEE_BPS);
        
        // Transfer tokens to flash loan pool
        token.transfer(address(flashLoan), INITIAL_BALANCE / 2);
        
        // Update pool balance
        vm.prank(owner);
        flashLoan.syncBalance();
        
        receiver = new MockFlashLoanReceiver();
    }
    
    // Test: Zero-fee prevention for small amounts
    function test_ZeroFeePrevention() public {
        uint256 smallAmount = 100; // Very small amount
        
        // Calculate expected fee
        uint256 expectedFee = smallAmount * FEE_BPS / 10000;
        if (expectedFee < 1) {
            expectedFee = 1;
        }
        
        // Execute flash loan
        vm.prank(borrower);
        flashLoan.flashLoan(smallAmount, "");
        
        // Verify minimum fee was charged
        assertEq(flashLoan.totalFees(), expectedFee, "Minimum fee should be 1");
    }
    
    // Test: Max loan cap at 50% of pool
    function test_MaxLoanCap() public {
        uint256 poolBalance = flashLoan.getPoolBalance();
        uint256 maxLoan = poolBalance * 50 / 100;
        
        // Should revert if trying to borrow more than 50%
        vm.prank(borrower);
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(maxLoan + 1, "");
    }
    
    // Test: Successful flash loan
    function test_SuccessfulFlashLoan() public {
        uint256 loanAmount = LOAN_AMOUNT;
        uint256 expectedFee = loanAmount * FEE_BPS / 10000;
        if (expectedFee < 1) {
            expectedFee = 1;
        }
        
        uint256 poolBalanceBefore = flashLoan.getPoolBalance();
        
        vm.prank(borrower);
        flashLoan.flashLoan(loanAmount, "");
        
        uint256 poolBalanceAfter = flashLoan.getPoolBalance();
        
        // Pool balance should increase by fee
        assertEq(poolBalanceAfter, poolBalanceBefore + expectedFee, "Pool balance should increase by fee");
        
        // Total fees should be updated
        assertEq(flashLoan.totalFees(), expectedFee, "Total fees should be updated");
    }
    
    // Test: Internal accounting consistency
    function test_InternalAccounting() public {
        uint256 initialPoolBalance = flashLoan.getPoolBalance();
        uint256 initialTotalFees = flashLoan.totalFees();
        
        // Execute multiple flash loans
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(borrower);
            flashLoan.flashLoan(LOAN_AMOUNT, "");
        }
        
        uint256 finalPoolBalance = flashLoan.getPoolBalance();
        uint256 finalTotalFees = flashLoan.totalFees();
        
        // Pool balance should increase by total fees
        uint256 totalFeesCollected = finalTotalFees - initialTotalFees;
        assertEq(finalPoolBalance, initialPoolBalance + totalFeesCollected, "Pool balance should match internal accounting");
    }
    
    // Test: Deposit to pool
    function test_DepositToPool() public {
        uint256 depositAmount = 100 ether;
        
        // Transfer tokens to borrower for deposit
        token.transfer(borrower, depositAmount);
        
        uint256 poolBalanceBefore = flashLoan.getPoolBalance();
        
        vm.prank(borrower);
        token.approve(address(flashLoan), depositAmount);
        
        vm.prank(borrower);
        flashLoan.depositToPool(depositAmount);
        
        uint256 poolBalanceAfter = flashLoan.getPoolBalance();
        
        assertEq(poolBalanceAfter, poolBalanceBefore + depositAmount, "Pool balance should increase by deposit");
    }
    
    // Test: Withdraw fees
    function test_WithdrawFees() public {
        // Execute a flash loan to generate fees
        vm.prank(borrower);
        flashLoan.flashLoan(LOAN_AMOUNT, "");
        
        uint256 fees = flashLoan.totalFees();
        uint256 ownerBalanceBefore = token.balanceOf(owner);
        
        vm.prank(owner);
        flashLoan.withdrawFees();
        
        uint256 ownerBalanceAfter = token.balanceOf(owner);
        
        assertEq(ownerBalanceAfter, ownerBalanceBefore + fees, "Owner should receive fees");
        assertEq(flashLoan.totalFees(), 0, "Total fees should be reset");
    }
    
    // Test: Zero amount should revert
    function test_ZeroAmount() public {
        vm.prank(borrower);
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }
    
    // Test: Fee BPS update
    function test_FeeBPSUpdate() public {
        uint256 newFeeBPS = 100; // 1%
        
        vm.prank(owner);
        flashLoan.setFeeBPS(newFeeBPS);
        
        assertEq(flashLoan.feeBPS(), newFeeBPS, "Fee BPS should be updated");
    }
    
    // Test: Invalid fee BPS should revert
    function test_InvalidFeeBPS() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        flashLoan.setFeeBPS(0);
        
        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        flashLoan.setFeeBPS(1001); // > 10%
    }
    
    // Test: Sync balance
    function test_SyncBalance() public {
        // Directly transfer tokens to pool (simulating donation)
        token.transfer(address(flashLoan), 100 ether);
        
        uint256 actualBalance = token.balanceOf(address(flashLoan));
        uint256 poolBalance = flashLoan.getPoolBalance();
        
        // Pool balance should be different from actual balance
        assertTrue(poolBalance != actualBalance, "Pool balance should differ from actual balance");
        
        // Sync balance
        vm.prank(owner);
        flashLoan.syncBalance();
        
        // After sync, pool balance should match actual balance
        assertEq(flashLoan.getPoolBalance(), actualBalance, "Pool balance should match actual balance after sync");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../FlashLoan.sol";
import "../MockContracts.sol";

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockERC20 public token;
    MockFlashLoanReceiver public receiver;
    MockFlashLoanReceiverNoRepay public noRepayReceiver;

    address public owner = address(1);
    address public borrower = address(2);
    address public nonOwner = address(3);

    uint256 public constant FEE_BPS = 50; // 0.5%
    uint256 public constant INITIAL_BALANCE = 1000 ether;
    uint256 public constant LOAN_AMOUNT = 100 ether;
    uint256 public constant RECEIVER_FUNDING = 10 ether; // To cover flash loan fees

    function setUp() public {
        // Owner creates token and gets initial supply
        vm.prank(owner);
        token = new MockERC20("Test Token", "TT", INITIAL_BALANCE);

        // Owner deploys FlashLoan
        vm.prank(owner);
        flashLoan = new FlashLoan(address(token), FEE_BPS, owner);

        // Owner transfers tokens to flash loan pool
        vm.prank(owner);
        token.transfer(address(flashLoan), INITIAL_BALANCE / 2);

        // Sync pool balance
        vm.prank(owner);
        flashLoan.syncBalance();

        // Create mock receivers with correct constructor args
        receiver = new MockFlashLoanReceiver(address(token));
        noRepayReceiver = new MockFlashLoanReceiverNoRepay();

        // Fund receiver with tokens to cover flash loan fees
        vm.prank(owner);
        token.transfer(address(receiver), RECEIVER_FUNDING);

        // Also fund noRepayReceiver (so it has tokens for revert-path testing)
        vm.prank(owner);
        token.transfer(address(noRepayReceiver), RECEIVER_FUNDING);

        // Fund borrower for deposit/transfer tests
        vm.prank(owner);
        token.transfer(borrower, 200 ether);
    }

    // ===========================
    //  Acceptance Criteria: Zero-fee prevention
    //  Issue #919 — FlashLoan zero-fee exploit fix
    // ===========================

    /// @dev Tests that MIN_FEE=1 prevents zero-fee for tiny amounts
    function test_ZeroFeePrevention_MinimumFeeEnforced() public {
        uint256 smallAmount = 100; // Very small — fee would round to 0

        // Calculate expected fee: 100 * 50 / 10000 = 0 → enforced MIN_FEE = 1
        uint256 rawFee = smallAmount * FEE_BPS / 10000;
        assertEq(rawFee, 0, "Raw fee should be 0 for tiny amount");

        uint256 poolBalanceBefore = flashLoan.getPoolBalance();

        // Execute flash loan via proper receiver
        vm.prank(address(receiver));
        flashLoan.flashLoan(smallAmount, "");

        uint256 poolBalanceAfter = flashLoan.getPoolBalance();

        // Pool balance should increase by MIN_FEE (1 token)
        assertEq(poolBalanceAfter, poolBalanceBefore + 1, "Pool should gain 1 token (MIN_FEE)");
        assertEq(flashLoan.totalFees(), 1, "Total fees should be 1 (MIN_FEE)");
    }

    // ===========================
    //  Acceptance Criteria: Max loan cap at 50% of pool
    // ===========================

    /// @dev Tests that loans exceeding 50% of pool balance revert
    function test_MaxLoanCap_RevertsOver50Percent() public {
        uint256 poolBalance = flashLoan.getPoolBalance();
        uint256 maxLoan = poolBalance * 50 / 100;

        // Slightly over 50% should revert
        vm.prank(address(receiver));
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(maxLoan + 1, "");
    }

    /// @dev Tests that exactly 50% is allowed
    function test_MaxLoanCap_Exactly50Percent() public {
        uint256 poolBalance = flashLoan.getPoolBalance();
        uint256 maxLoan = poolBalance * 50 / 100;

        vm.prank(address(receiver));
        flashLoan.flashLoan(maxLoan, "");

        // Should succeed — exactly at the cap
        assertTrue(flashLoan.totalFees() > 0, "Fee should be charged");
    }

    // ===========================
    //  Acceptance Criteria: Successful flash loan execution
    // ===========================

    /// @dev Full happy path: borrow → callback → repay+ fee → pool grows
    function test_SuccessfulFlashLoan() public {
        uint256 expectedFee = LOAN_AMOUNT * FEE_BPS / 10000;
        assertTrue(expectedFee > 0, "Fee should be > 0");

        uint256 poolBalanceBefore = flashLoan.getPoolBalance();
        uint256 receiverBalanceBefore = token.balanceOf(address(receiver));

        // Execute flash loan via receiver (which properly approves repayment)
        vm.prank(address(receiver));
        flashLoan.flashLoan(LOAN_AMOUNT, "");

        uint256 poolBalanceAfter = flashLoan.getPoolBalance();
        uint256 receiverBalanceAfter = token.balanceOf(address(receiver));

        // Pool balance should increase by the fee
        assertEq(poolBalanceAfter, poolBalanceBefore + expectedFee, "Pool balance should increase by fee");

        // Total fees should be updated
        assertEq(flashLoan.totalFees(), expectedFee, "Total fees should track fee amount");

        // Receiver should have lost exactly the fee (net: received amount, repaid amount + fee)
        assertEq(receiverBalanceAfter, receiverBalanceBefore - expectedFee, "Receiver should only lose the fee");
    }

    // ===========================
    //  Acceptance Criteria: Pause/Unpause functionality
    // ===========================

    /// @dev Pause prevents flash loans, unpause re-enables them
    function test_PauseFunctionality() public {
        // Pause the contract
        vm.prank(owner);
        flashLoan.pause();

        // Flash loan should revert when paused
        vm.prank(address(receiver));
        vm.expectRevert("Pausable: paused");
        flashLoan.flashLoan(LOAN_AMOUNT, "");

        // Unpause
        vm.prank(owner);
        flashLoan.unpause();

        // Should work after unpause
        vm.prank(address(receiver));
        flashLoan.flashLoan(LOAN_AMOUNT, "");

        assertTrue(flashLoan.totalFees() > 0, "Fee should be charged after unpause");
    }

    // ===========================
    //  Acceptance Criteria: Internal accounting consistency
    // ===========================

    /// @dev Multiple flash loans → pool balance tracks accumulated fees correctly
    function test_InternalAccounting() public {
        uint256 initialPoolBalance = flashLoan.getPoolBalance();
        uint256 expectedFee = LOAN_AMOUNT * FEE_BPS / 10000;

        // Execute multiple flash loans
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(address(receiver));
            flashLoan.flashLoan(LOAN_AMOUNT, "");
        }

        uint256 finalPoolBalance = flashLoan.getPoolBalance();
        uint256 finalTotalFees = flashLoan.totalFees();

        // Pool balance should increase by totalFees
        assertEq(finalPoolBalance, initialPoolBalance + finalTotalFees, "Pool balance should match internal accounting");

        // Each loan charged the expected fee
        assertEq(finalTotalFees, expectedFee * 5, "Total fees should equal 5 * per-loan fee");
    }

    // ===========================
    //  Acceptance Criteria: Flash loan without repayment reverts
    // ===========================

    /// @dev NoRepayReceiver does NOT approve repayment → safeTransferFrom reverts
    function test_FlashLoanNoRepayment() public {
        vm.prank(address(noRepayReceiver));
        vm.expectRevert(); // SafeERC20: ERC20 operation failed (no allowance)
        flashLoan.flashLoan(LOAN_AMOUNT, "");
    }

    // ===========================
    //  Acceptance Criteria: Input validation
    // ===========================

    /// @dev Zero amount should revert
    function test_ZeroAmount() public {
        vm.prank(address(receiver));
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }

    // ===========================
    //  Acceptance Criteria: Fee BPS management
    // ===========================

    /// @dev Owner can update fee BPS within valid range
    function test_FeeBPSUpdate() public {
        uint256 newFeeBPS = 100; // 1%

        vm.prank(owner);
        flashLoan.setFeeBPS(newFeeBPS);

        assertEq(flashLoan.feeBPS(), newFeeBPS, "Fee BPS should be updated");
    }

    /// @dev Invalid fee BPS values should revert
    function test_InvalidFeeBPS() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        flashLoan.setFeeBPS(0);

        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        flashLoan.setFeeBPS(1001); // > 10%
    }

    // ===========================
    //  Acceptance Criteria: Deposit to pool
    // ===========================

    /// @dev Anyone can deposit tokens to the lending pool
    function test_DepositToPool() public {
        uint256 depositAmount = 100 ether;
        uint256 poolBalanceBefore = flashLoan.getPoolBalance();

        vm.prank(borrower);
        token.approve(address(flashLoan), depositAmount);

        vm.prank(borrower);
        flashLoan.depositToPool(depositAmount);

        uint256 poolBalanceAfter = flashLoan.getPoolBalance();

        assertEq(poolBalanceAfter, poolBalanceBefore + depositAmount, "Pool balance should increase by deposit");
    }

    /// @dev Zero deposit should revert
    function test_DepositToPool_ZeroAmount() public {
        vm.prank(borrower);
        vm.expectRevert("Amount must be > 0");
        flashLoan.depositToPool(0);
    }

    // ===========================
    //  Acceptance Criteria: Withdraw fees (owner only)
    // ===========================

    /// @dev Owner can withdraw accumulated fees
    function test_WithdrawFees() public {
        // Execute a flash loan to generate fees
        vm.prank(address(receiver));
        flashLoan.flashLoan(LOAN_AMOUNT, "");

        uint256 fees = flashLoan.totalFees();
        assertTrue(fees > 0, "Fees should be > 0");

        uint256 ownerBalanceBefore = token.balanceOf(owner);

        vm.prank(owner);
        flashLoan.withdrawFees();

        uint256 ownerBalanceAfter = token.balanceOf(owner);

        assertEq(ownerBalanceAfter, ownerBalanceBefore + fees, "Owner should receive fees");
        assertEq(flashLoan.totalFees(), 0, "Total fees should be reset after withdrawal");
    }

    /// @dev Withdrawing with zero fees should revert
    function test_WithdrawFees_NoFees() public {
        vm.prank(owner);
        vm.expectRevert("No fees to withdraw");
        flashLoan.withdrawFees();
    }

    // ===========================
    //  Acceptance Criteria: Sync balance
    // ===========================

    /// @dev syncBalance updates internal accounting to match actual token balance
    function test_SyncBalance() public {
        // Directly transfer tokens to pool (simulating donation)
        vm.prank(owner);
        token.transfer(address(flashLoan), 100 ether);

        uint256 actualBalance = token.balanceOf(address(flashLoan));
        uint256 poolBalance = flashLoan.getPoolBalance();

        // Before sync: pool balance ≠ actual balance
        assertTrue(poolBalance != actualBalance, "Pool balance should differ before sync");

        // Owner syncs
        vm.prank(owner);
        flashLoan.syncBalance();

        // After sync: pool balance matches actual
        assertEq(flashLoan.getPoolBalance(), actualBalance, "Pool balance should match actual after sync");
    }

    // ===========================
    //  Access Control: onlyOwner reverts
    // ===========================

    /// @dev Non-owner cannot pause
    function test_RevertWhen_NonOwnerPause() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        flashLoan.pause();
    }

    /// @dev Non-owner cannot unpause
    function test_RevertWhen_NonOwnerUnpause() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        flashLoan.unpause();
    }

    /// @dev Non-owner cannot set fee BPS
    function test_RevertWhen_NonOwnerSetFeeBPS() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        flashLoan.setFeeBPS(100);
    }

    /// @dev Non-owner cannot withdraw fees
    function test_RevertWhen_NonOwnerWithdrawFees() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        flashLoan.withdrawFees();
    }

    /// @dev Non-owner cannot sync balance
    function test_RevertWhen_NonOwnerSyncBalance() public {
        vm.prank(nonOwner);
        vm.expectRevert();
        flashLoan.syncBalance();
    }

    // ===========================
    //  Edge Cases
    // ===========================

    /// @dev getPoolBalance returns the internal accounting value
    function test_GetPoolBalance() public {
        uint256 poolBalance = flashLoan.getPoolBalance();
        assertEq(poolBalance, INITIAL_BALANCE / 2, "getPoolBalance should return initial balance");
    }

    /// @dev Flash loan with exact fee=1 boundary
    function test_FlashLoan_FeeAtBoundary() public {
        // Amount where fee would be exactly 0 (200 * 50/10000 = 1, wait... 199 * 50/10000 = 0.995 → 0)
        // Find the largest amount that gives rawFee = 0: amount < 200 => rawFee = 0 for amount=199
        // At amount=199: rawFee = 199*50/10000 = 0, enforced MIN_FEE = 1
        uint256 boundaryAmount = 199;

        vm.prank(address(receiver));
        flashLoan.flashLoan(boundaryAmount, "");

        assertEq(flashLoan.totalFees(), 1, "Fee should be MIN_FEE=1 at boundary");
    }

    // ===========================
    //  Acceptance Criteria: Rebasing token protection
    //  Issue #919 — Internal accounting prevents balanceOf manipulation
    // ===========================

    /// @dev FlashLoan with rebasing token uses internal accounting (not balanceOf)
    function test_RebasingToken_InternalAccounting() public {
        // Deploy a rebasing token that reports 10x balance
        vm.prank(owner);
        MockRebasingToken rebaseToken = new MockRebasingToken("Rebase", "RBT");

        // Mint tokens to owner (balanceOf returns 10x)
        rebaseToken.mint(owner, 1000 ether);

        // Deploy FlashLoan with rebasing token
        vm.prank(owner);
        FlashLoan rebaseFlashLoan = new FlashLoan(address(rebaseToken), FEE_BPS, owner);

        // Transfer tokens to FlashLoan pool (using normal transfer)
        uint256 depositAmount = 500 ether;
        vm.prank(owner);
        rebaseToken.approve(address(rebaseFlashLoan), depositAmount);

        vm.prank(owner);
        rebaseFlashLoan.depositToPool(depositAmount);

        // Internal accounting should reflect deposited amount (NOT 10x balanceOf)
        uint256 poolBalance = rebaseFlashLoan.getPoolBalance();
        assertEq(poolBalance, depositAmount, "poolBalance should track actual deposit");

        // balanceOf would report 5000 ether (10x), but internal accounting reports 500 ether
        uint256 balanceOfPool = rebaseToken.balanceOf(address(rebaseFlashLoan));
        assertTrue(balanceOfPool > poolBalance, "balanceOf should be inflated by rebase");

        // Create a funded receiver for the rebasing token
        MockFlashLoanReceiver rebaseReceiver = new MockFlashLoanReceiver(address(rebaseToken));
        vm.prank(owner);
        rebaseToken.transfer(address(rebaseReceiver), 100 ether);

        // Execute flash loan — internal accounting should track correctly
        uint256 poolBefore = rebaseFlashLoan.getPoolBalance();

        vm.prank(address(rebaseReceiver));
        rebaseFlashLoan.flashLoan(LOAN_AMOUNT, "");

        uint256 poolAfter = rebaseFlashLoan.getPoolBalance();
        uint256 fees = rebaseFlashLoan.totalFees();

        // Pool balance should increase by the fee (not inflated by rebase)
        assertEq(poolAfter, poolBefore + fees, "Internal accounting should be consistent");
        assertTrue(fees > 0, "Fees should be tracked correctly");

        // syncBalance would be affected by rebasing — shows why manual sync is dangerous
        vm.prank(owner);
        rebaseFlashLoan.syncBalance();
        uint256 poolAfterSync = rebaseFlashLoan.getPoolBalance();
        assertTrue(poolAfterSync > poolAfter, "syncBalance reads inflated balanceOf");
    }

    // ===========================
    //  Edge Cases: Deposit when paused
    // ===========================

    /// @dev depositToPool should work even when flash loans are paused
    function test_DepositToPool_WhenPaused() public {
        // Pause flash loans
        vm.prank(owner);
        flashLoan.pause();

        // Deposit should still work (depositToPool is not behind whenNotPaused)
        uint256 depositAmount = 100 ether;
        uint256 poolBalanceBefore = flashLoan.getPoolBalance();

        vm.prank(borrower);
        token.approve(address(flashLoan), depositAmount);

        vm.prank(borrower);
        flashLoan.depositToPool(depositAmount);

        uint256 poolBalanceAfter = flashLoan.getPoolBalance();
        assertEq(poolBalanceAfter, poolBalanceBefore + depositAmount, "Deposit should work when paused");
    }

    // ===========================
    //  Edge Cases: Fee BPS at max (1000 = 10%)
    // ===========================

    /// @dev setFeeBPS at exactly the maximum allowed (1000 BPS = 10%)
    function test_FeeBPS_MaxAllowed() public {
        vm.prank(owner);
        flashLoan.setFeeBPS(1000);

        assertEq(flashLoan.feeBPS(), 1000, "Fee BPS should be 1000 (10%)");

        // Verify flash loan works with new fee
        uint256 poolBalanceBefore = flashLoan.getPoolBalance();

        vm.prank(address(receiver));
        flashLoan.flashLoan(LOAN_AMOUNT, "");

        uint256 poolBalanceAfter = flashLoan.getPoolBalance();
        uint256 expectedFee = LOAN_AMOUNT * 1000 / 10000; // 10 ether
        assertEq(poolBalanceAfter, poolBalanceBefore + expectedFee, "10% fee should be charged");
    }
}

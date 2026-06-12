// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("MockToken", "MTK") {
        _mint(msg.sender, 1e30);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    IERC20 public token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external override {
        // Repay loan + fee back to the caller (flash loan contract)
        token.transfer(msg.sender, amount + fee);
    }
}

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockToken public token;
    MockFlashLoanReceiver public receiver;

    uint256 public constant FEE_BPS = 50; // 0.5%
    uint256 public constant POOL_AMOUNT = 1_000_000 ether;

    function setUp() public {
        token = new MockToken();
        flashLoan = new FlashLoan(address(token), FEE_BPS);
        receiver = new MockFlashLoanReceiver(address(token));

        // Fund the pool via depositToPool so internalBalance stays in sync
        token.approve(address(flashLoan), POOL_AMOUNT);
        flashLoan.depositToPool(POOL_AMOUNT);
    }

    // ============================================================
    // TEST: Zero-fee prevention
    // ============================================================
    function test_ZeroFeePrevented() public {
        // With feeBPS=50 (0.5%), a loan of 100 tokens has fee = 100*50/10000 = 0
        // Our fix enforces minimum fee of 1
        uint256 smallLoan = 100;
        uint256 rawFee = smallLoan * FEE_BPS / 10000;
        assertTrue(rawFee == 0, "Fee should truncate to 0 without fix");

        // Fund receiver with enough to repay (smallLoan + min fee of 1)
        token.mint(address(receiver), smallLoan + 1);

        // Execute flash loan — should succeed with min fee of 1
        vm.prank(address(receiver));
        flashLoan.flashLoan(smallLoan, "");

        // Pool should have gained at least 1 token from the min fee
        assertTrue(flashLoan.totalFees() >= 1, "Minimum fee should be applied");
    }

    // ============================================================
    // TEST: Max loan cap at 50% of pool
    // ============================================================
    function test_MaxLoanCapEnforced() public {
        uint256 maxLoan = POOL_AMOUNT * 5000 / 10000; // 50%
        uint256 overMaxLoan = maxLoan + 1;

        vm.expectRevert("Exceeds max loan amount");
        vm.prank(address(receiver));
        flashLoan.flashLoan(overMaxLoan, "");
    }

    function test_MaxLoanAtBoundary() public {
        uint256 maxLoan = POOL_AMOUNT * 5000 / 10000;

        // Fund receiver with enough to repay
        token.mint(address(receiver), maxLoan);

        // Should succeed at exactly 50%
        vm.prank(address(receiver));
        flashLoan.flashLoan(maxLoan, "");
    }

    // ============================================================
    // TEST: Internal accounting
    // ============================================================
    function test_InternalAccounting() public {
        assertEq(flashLoan.internalBalance(), POOL_AMOUNT);
        assertEq(flashLoan.getPoolBalance(), POOL_AMOUNT);
    }

    // ============================================================
    // TEST: Emergency pause
    // ============================================================
    function test_PauseDisablesFlashLoans() public {
        flashLoan.pause();
        assertTrue(flashLoan.paused());

        vm.expectRevert("Paused");
        vm.prank(address(receiver));
        flashLoan.flashLoan(1000 ether, "");
    }

    function test_UnpauseReenablesFlashLoans() public {
        flashLoan.pause();
        flashLoan.unpause();
        assertFalse(flashLoan.paused());

        // Fund receiver
        token.mint(address(receiver), 1000 ether);

        vm.prank(address(receiver));
        flashLoan.flashLoan(1000 ether, "");
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("Not owner");
        flashLoan.pause();
    }

    function test_OnlyOwnerCanUnpause() public {
        flashLoan.pause();

        vm.prank(address(0xDEAD));
        vm.expectRevert("Not owner");
        flashLoan.unpause();
    }

    // ============================================================
    // TEST: Fee accrual tracked correctly
    // ============================================================
    function test_FeeAccrualTracked() public {
        uint256 loanAmount = 10_000 ether;
        uint256 expectedFee = loanAmount * FEE_BPS / 10000; // 50 ether

        // Fund receiver
        token.mint(address(receiver), loanAmount);

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        assertEq(flashLoan.totalFees(), expectedFee);
    }

    function test_MultipleLoansAccrueFees() public {
        uint256 loanAmount = 10_000 ether;
        uint256 expectedFeePerLoan = loanAmount * FEE_BPS / 10000;

        // Fund receiver generously
        token.mint(address(receiver), 100_000 ether);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(address(receiver));
            flashLoan.flashLoan(loanAmount, "");
        }

        assertEq(flashLoan.totalFees(), expectedFeePerLoan * 3);
    }

    // ============================================================
    // TEST: Successful flash loan flow
    // ============================================================
    function test_SuccessfulFlashLoan() public {
        uint256 loanAmount = 10_000 ether;
        uint256 fee = loanAmount * FEE_BPS / 10000;

        token.mint(address(receiver), loanAmount);

        uint256 poolBefore = flashLoan.internalBalance();

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        // Pool should have gained the fee
        assertEq(flashLoan.internalBalance(), poolBefore + fee);
    }

    // ============================================================
    // TEST: Zero amount rejected
    // ============================================================
    function test_ZeroAmountRejected() public {
        vm.expectRevert("Amount must be > 0");
        vm.prank(address(receiver));
        flashLoan.flashLoan(0, "");
    }

    // ============================================================
    // TEST: Insufficient pool balance
    // ============================================================
    function test_InsufficientPoolBalance() public {
        vm.expectRevert("Insufficient pool balance");
        vm.prank(address(receiver));
        flashLoan.flashLoan(POOL_AMOUNT + 1, "");
    }

    // ============================================================
    // TEST: Deposit and withdraw
    // ============================================================
    function test_DepositToPool() public {
        uint256 depositAmount = 1000 ether;
        token.approve(address(flashLoan), depositAmount);
        flashLoan.depositToPool(depositAmount);

        assertEq(flashLoan.internalBalance(), POOL_AMOUNT + depositAmount);
    }

    function test_WithdrawFees() public {
        uint256 loanAmount = 10_000 ether;
        token.mint(address(receiver), loanAmount);

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        uint256 fees = flashLoan.totalFees();
        uint256 ownerBalBefore = token.balanceOf(address(this));

        flashLoan.withdrawFees();

        assertEq(token.balanceOf(address(this)), ownerBalBefore + fees);
        assertEq(flashLoan.totalFees(), 0);
    }
}

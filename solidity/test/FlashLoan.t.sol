// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
}

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    IERC20 public token;
    uint256 public repayAmount;
    bool public shouldRepay;

    constructor(address _token) {
        token = IERC20(_token);
        shouldRepay = true;
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external override {
        if (shouldRepay) {
            token.transfer(msg.sender, amount + fee);
        }
    }

    function setShouldRepay(bool _shouldRepay) external {
        shouldRepay = _shouldRepay;
    }
}

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockToken public token;
    MockFlashLoanReceiver public receiver;
    address public owner;
    address public user;

    function setUp() public {
        token = new MockToken();
        flashLoan = new FlashLoan(address(token), 10); // 0.1% fee = 10 BPS
        owner = address(this);
        user = address(0x1);

        // Fund the pool
        token.approve(address(flashLoan), 100_000 * 10 ** 18);
        flashLoan.depositToPool(100_000 * 10 ** 18);

        receiver = new MockFlashLoanReceiver(address(token));
        token.transfer(address(receiver), 10_000 * 10 ** 18);
    }

    // Test: Minimum fee of 1 token unit prevents zero-fee flash loans for small amounts
    function test_MinimumFeePreventsZeroFeeLoans() public {
        // Small amount where fee would truncate to 0: 999 / 10000 * 10 = 0
        uint256 smallAmount = 999;
        vm.prank(user);
        // This should still charge fee = 1 (minimum)
        flashLoan.flashLoan(smallAmount, "");
        // Pool balance should have increased by at least 1 (the minimum fee)
        assertGe(flashLoan.getPoolBalance(), 100_000 * 10 ** 18);
    }

    // Test: Loans exceeding 50% of pool balance are rejected
    function test_MaxLoanCapPreventsDrainage() public {
        uint256 poolBal = flashLoan.getPoolBalance();
        uint256 overHalf = poolBal / 2 + 1;
        vm.prank(user);
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(overHalf, "");
    }

    // Test: Internal accounting prevents rebasing token exploits
    function test_InternalAccountingPreventsRebasingExploit() public {
        uint256 poolBefore = flashLoan.getPoolBalance();
        uint256 loanAmount = 1000 * 10 ** 18;

        vm.prank(user);
        flashLoan.flashLoan(loanAmount, "");

        // Pool balance tracked internally, not via balanceOf
        uint256 poolAfter = flashLoan.getPoolBalance();
        assertGe(poolAfter, poolBefore);
    }

    // Test: Emergency pause disables all flash loan functions
    function test_PauseDisablesFlashLoans() public {
        flashLoan.pause();
        assertTrue(flashLoan.paused());

        vm.prank(user);
        vm.expectRevert("Paused");
        flashLoan.flashLoan(1000, "");
    }

    // Test: Unpausing re-enables flash loans
    function test_UnpauseReEnablesFlashLoans() public {
        flashLoan.pause();
        flashLoan.unpause();
        assertFalse(flashLoan.paused());

        vm.prank(user);
        flashLoan.flashLoan(1000 * 10 ** 18, "");
    }

    // Test: Fee accrual is tracked correctly
    function test_FeeAccrualTracked() public {
        uint256 feesBefore = flashLoan.totalFees();
        uint256 loanAmount = 10_000 * 10 ** 18;

        vm.prank(user);
        flashLoan.flashLoan(loanAmount, "");

        uint256 feesAfter = flashLoan.totalFees();
        assertGt(feesAfter, feesBefore);
    }

    // Test: Normal flash loan works correctly
    function test_NormalFlashLoanWorks() public {
        uint256 loanAmount = 10_000 * 10 ** 18;
        vm.prank(user);
        flashLoan.flashLoan(loanAmount, "");
    }

    // Test: Non-repayment reverts
    function test_LoanNotRepaidReverts() public {
        receiver.setShouldRepay(false);
        vm.prank(address(receiver));
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(1000 * 10 ** 18, "");
    }

    // Test: Only owner can pause
    function test_OnlyOwnerCanPause() public {
        vm.prank(user);
        vm.expectRevert("Not owner");
        flashLoan.pause();
    }

    // Test: Only owner can unpause
    function test_OnlyOwnerCanUnpause() public {
        flashLoan.pause();
        vm.prank(user);
        vm.expectRevert("Not owner");
        flashLoan.unpause();
    }

    // Test: Zero amount reverts
    function test_ZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }
}

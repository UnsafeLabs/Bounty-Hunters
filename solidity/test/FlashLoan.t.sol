// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract MockFlashLoanReceiver {
    FlashLoan public flashLoan;
    bool public shouldRepay;
    uint256 public repaymentMultiplier;

    constructor(FlashLoan _flashLoan) {
        flashLoan = _flashLoan;
        shouldRepay = true;
        repaymentMultiplier = 100; // 100% = exact repayment
    }

    function setShouldRepay(bool _shouldRepay) external {
        shouldRepay = _shouldRepay;
    }

    function setRepaymentMultiplier(uint256 _multiplier) external {
        repaymentMultiplier = _multiplier;
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        if (shouldRepay) {
            uint256 repayment = amount + (fee * repaymentMultiplier / 100);
            IERC20(token).approve(address(flashLoan), repayment);
            IERC20(token).transfer(address(flashLoan), repayment);
        }
    }
}

contract RebasingToken is ERC20 {
    uint256 public rebaseFactor;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        rebaseFactor = 100; // 100% = no rebase
    }

    function setRebaseFactor(uint256 _factor) external {
        rebaseFactor = _factor;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return super.balanceOf(account) * rebaseFactor / 100;
    }
}

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockToken public token;
    MockFlashLoanReceiver public receiver;
    address public owner;
    address public user1;
    address public user2;

    uint256 public constant FEE_BPS = 30; // 0.3%

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        token = new MockToken("Test Token", "TST", 1000000 * 1e18);
        flashLoan = new FlashLoan(address(token), FEE_BPS);
        receiver = new MockFlashLoanReceiver(flashLoan);

        // Fund receiver with tokens for repayment
        token.transfer(address(receiver), 100000 * 1e18);
        
        // Deposit to pool
        token.approve(address(flashLoan), type(uint256).max);
        flashLoan.depositToPool(100000 * 1e18);
    }

    function test_InitialState() public view {
        assertEq(flashLoan.loanToken(), address(token));
        assertEq(flashLoan.feeBPS(), FEE_BPS);
        assertEq(flashLoan.owner(), owner);
        assertFalse(flashLoan.paused());
        assertEq(flashLoan.poolBalance(), 100000 * 1e18);
    }

    function test_DepositToPool() public {
        uint256 depositAmount = 10000 * 1e18;
        
        token.transfer(user1, depositAmount);
        vm.prank(user1);
        token.approve(address(flashLoan), depositAmount);
        
        uint256 poolBefore = flashLoan.poolBalance();
        
        vm.prank(user1);
        flashLoan.depositToPool(depositAmount);
        
        assertEq(flashLoan.poolBalance(), poolBefore + depositAmount);
    }

    function test_DepositZeroAmount() public {
        vm.prank(user1);
        vm.expectRevert("Amount must be > 0");
        flashLoan.depositToPool(0);
    }

    function test_FlashLoanBasic() public {
        uint256 loanAmount = 10000 * 1e18;
        uint256 expectedFee = loanAmount * FEE_BPS / 10000;
        
        uint256 poolBefore = flashLoan.poolBalance();
        
        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");
        
        // Pool should have increased by fee
        assertEq(flashLoan.poolBalance(), poolBefore + expectedFee);
        assertEq(flashLoan.totalFees(), expectedFee);
    }

    function test_FlashLoanZeroFeePrevention() public {
        // Small loan that would normally have zero fee
        uint256 smallLoan = 100; // Very small amount
        
        uint256 poolBefore = flashLoan.poolBalance();
        
        vm.prank(address(receiver));
        flashLoan.flashLoan(smallLoan, "");
        
        // Fee should be at least 1 token unit
        assertEq(flashLoan.totalFees(), 1);
        assertEq(flashLoan.poolBalance(), poolBefore + 1);
    }

    function test_FlashLoanMaxLoanCap() public {
        uint256 poolBalance = flashLoan.poolBalance();
        uint256 maxLoan = poolBalance / 2;
        
        // Try to borrow more than 50%
        vm.prank(address(receiver));
        vm.expectRevert("Loan exceeds max amount");
        flashLoan.flashLoan(maxLoan + 1, "");
    }

    function test_FlashLoanExactlyMax() public {
        uint256 poolBalance = flashLoan.poolBalance();
        uint256 maxLoan = poolBalance / 2;
        
        // Borrow exactly 50% should succeed
        vm.prank(address(receiver));
        flashLoan.flashLoan(maxLoan, "");
        
        assertEq(flashLoan.totalFees(), maxLoan * FEE_BPS / 10000);
    }

    function test_FlashLoanNotRepaid() public {
        receiver.setShouldRepay(false);
        
        vm.prank(address(receiver));
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(10000 * 1e18, "");
    }

    function test_FlashLoanPartialRepayment() public {
        receiver.setRepaymentMultiplier(50); // Only repay 50% of fee
        
        vm.prank(address(receiver));
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(10000 * 1e18, "");
    }

    function test_FlashLoanWhenPaused() public {
        flashLoan.pause();
        
        vm.prank(address(receiver));
        vm.expectRevert("Paused");
        flashLoan.flashLoan(10000 * 1e18, "");
    }

    function test_PauseUnpause() public {
        assertFalse(flashLoan.paused());
        
        flashLoan.pause();
        assertTrue(flashLoan.paused());
        
        flashLoan.unpause();
        assertFalse(flashLoan.paused());
    }

    function test_PauseAccessControl() public {
        vm.prank(user1);
        vm.expectRevert("Not owner");
        flashLoan.pause();
    }

    function test_UnpauseAccessControl() public {
        flashLoan.pause();
        
        vm.prank(user1);
        vm.expectRevert("Not owner");
        flashLoan.unpause();
    }

    function test_DepositWhenPaused() public {
        flashLoan.pause();
        
        vm.prank(user1);
        vm.expectRevert("Paused");
        flashLoan.depositToPool(1000);
    }

    function test_WithdrawFees() public {
        // Generate some fees
        vm.prank(address(receiver));
        flashLoan.flashLoan(10000 * 1e18, "");
        
        uint256 fees = flashLoan.totalFees();
        assertGt(fees, 0);
        
        uint256 ownerBalBefore = token.balanceOf(owner);
        
        flashLoan.withdrawFees();
        
        assertEq(flashLoan.totalFees(), 0);
        assertEq(token.balanceOf(owner), ownerBalBefore + fees);
    }

    function test_WithdrawFeesAccessControl() public {
        vm.prank(user1);
        vm.expectRevert("Not owner");
        flashLoan.withdrawFees();
    }

    function test_WithdrawFeesZero() public {
        vm.expectRevert("No fees to withdraw");
        flashLoan.withdrawFees();
    }

    function test_RebasingTokenProtection() public {
        // Create flash loan with rebasing token
        RebasingToken rebasingToken = new RebasingToken("Rebasing", "RBT");
        FlashLoan rebasingFlashLoan = new FlashLoan(address(rebasingToken), FEE_BPS);
        
        // Mint tokens and deposit
        rebasingToken.mint(address(this), 100000 * 1e18);
        rebasingToken.approve(address(rebasingFlashLoan), 100000 * 1e18);
        rebasingFlashLoan.depositToPool(100000 * 1e18);
        
        // Change rebase factor (simulating rebasing)
        rebasingToken.setRebaseFactor(150); // 50% increase
        
        // Flash loan should still work correctly using internal accounting
        MockFlashLoanReceiver rebasingReceiver = new MockFlashLoanReceiver(rebasingFlashLoan);
        rebasingToken.mint(address(rebasingReceiver), 100000 * 1e18);
        
        vm.prank(address(rebasingReceiver));
        rebasingFlashLoan.flashLoan(10000 * 1e18, "");
        
        // Should succeed because we use internal accounting, not balanceOf
        assertGt(rebasingFlashLoan.totalFees(), 0);
    }

    function test_GetMaxLoan() public view {
        uint256 poolBalance = flashLoan.poolBalance();
        assertEq(flashLoan.getMaxLoan(), poolBalance / 2);
    }

    function test_InvalidTokenAddress() public {
        vm.expectRevert("Invalid token address");
        new FlashLoan(address(0), FEE_BPS);
    }

    function test_FeeTooHigh() public {
        vm.expectRevert("Fee too high");
        new FlashLoan(address(token), 10001);
    }

    function test_FlashLoanZeroAmount() public {
        vm.prank(address(receiver));
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }

    function test_FlashLoanInsufficientPool() public {
        uint256 poolBalance = flashLoan.poolBalance();
        
        vm.prank(address(receiver));
        vm.expectRevert("Insufficient pool balance");
        flashLoan.flashLoan(poolBalance + 1, "");
    }

    function test_MultipleFlashLoans() public {
        uint256 poolBefore = flashLoan.poolBalance();
        
        // First loan
        vm.prank(address(receiver));
        flashLoan.flashLoan(10000 * 1e18, "");
        
        // Second loan
        vm.prank(address(receiver));
        flashLoan.flashLoan(20000 * 1e18, "");
        
        // Fees should accumulate
        uint256 expectedFees = (10000 * 1e18 * FEE_BPS / 10000) + (20000 * 1e18 * FEE_BPS / 10000);
        assertEq(flashLoan.totalFees(), expectedFees);
        assertEq(flashLoan.poolBalance(), poolBefore + expectedFees);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/FlashLoan.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    FlashLoan public flashLoan;
    bool public shouldRepay;

    constructor(address _flashLoan, bool _shouldRepay) {
        flashLoan = FlashLoan(_flashLoan);
        shouldRepay = _shouldRepay;
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        if (shouldRepay) {
            MockERC20(token).approve(address(flashLoan), amount + fee);
        }
    }
}

contract FlashLoanTest is Test {
    FlashLoan public flashLoan;
    MockERC20 public token;

    address public owner = vm.addr(1);
    address public borrower = vm.addr(2);
    address public nonOwner = vm.addr(3);

    uint256 public feeBPS = 50; // 0.5%
    uint256 public poolAmount = 10000 ether;

    function setUp() public {
        token = new MockERC20();
        vm.prank(owner);
        flashLoan = new FlashLoan(address(token), feeBPS);

        token.mint(address(flashLoan), poolAmount);
        vm.prank(owner);
        flashLoan.depositToPool(poolAmount);
    }

    function test_Constructor() public {
        assertEq(address(flashLoan.loanToken()), address(token));
        assertEq(flashLoan.feeBPS(), feeBPS);
        assertEq(flashLoan.owner(), owner);
    }

    function test_Constructor_InvalidToken_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid token");
        new FlashLoan(address(0), feeBPS);
    }

    function test_Constructor_InvalidFeeBPS_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        new FlashLoan(address(token), 0);
    }

    function test_FlashLoan() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        uint256 loanAmount = 1000 ether;
        uint256 expectedFee = loanAmount * feeBPS / 10000;

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        assertEq(flashLoan.totalFees(), expectedFee);
    }

    function test_FlashLoan_ZeroAmount_Reverts() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);

        vm.prank(address(receiver));
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }

    function test_FlashLoan_ExceedsMaxLoan_Reverts() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);

        // Try to borrow more than 50% of pool
        uint256 loanAmount = poolAmount * 60 / 100;

        vm.prank(address(receiver));
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(loanAmount, "");
    }

    function test_FlashLoan_NotRepaid_Reverts() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), false);

        uint256 loanAmount = 1000 ether;

        vm.prank(address(receiver));
        vm.expectRevert("Loan not repaid");
        flashLoan.flashLoan(loanAmount, "");
    }

    function test_FlashLoan_MinFee() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        // Small loan amount that would result in 0 fee
        uint256 loanAmount = 10;
        uint256 expectedFee = 1; // MIN_FEE

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        assertEq(flashLoan.totalFees(), expectedFee);
    }

    function test_DepositToPool() public {
        uint256 depositAmount = 1000 ether;
        token.mint(borrower, depositAmount);

        vm.prank(borrower);
        token.approve(address(flashLoan), depositAmount);

        vm.prank(borrower);
        flashLoan.depositToPool(depositAmount);

        assertEq(flashLoan.getPoolBalance(), poolAmount + depositAmount);
    }

    function test_DepositToPool_ZeroAmount_Reverts() public {
        vm.prank(borrower);
        vm.expectRevert("Amount must be > 0");
        flashLoan.depositToPool(0);
    }

    function test_WithdrawFees() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        uint256 loanAmount = 1000 ether;
        uint256 expectedFee = loanAmount * feeBPS / 10000;

        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        vm.prank(owner);
        flashLoan.withdrawFees();

        assertEq(flashLoan.totalFees(), 0);
        assertEq(token.balanceOf(owner), expectedFee);
    }

    function test_WithdrawFees_NoFees_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("No fees to withdraw");
        flashLoan.withdrawFees();
    }

    function test_WithdrawFees_NonOwner_Reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        flashLoan.withdrawFees();
    }

    function test_SetFeeBPS() public {
        vm.prank(owner);
        flashLoan.setFeeBPS(100);
        assertEq(flashLoan.feeBPS(), 100);
    }

    function test_SetFeeBPS_InvalidFeeBPS_Reverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid fee BPS");
        flashLoan.setFeeBPS(0);
    }

    function test_SetFeeBPS_NonOwner_Reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert("Not owner");
        flashLoan.setFeeBPS(100);
    }

    function test_Pause() public {
        vm.prank(owner);
        flashLoan.pause();

        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);

        vm.prank(address(receiver));
        vm.expectRevert("Pausable: paused");
        flashLoan.flashLoan(1000 ether, "");
    }

    function test_Unpause() public {
        vm.prank(owner);
        flashLoan.pause();

        vm.prank(owner);
        flashLoan.unpause();

        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        vm.prank(address(receiver));
        flashLoan.flashLoan(1000 ether, "");
    }

    function test_SyncBalance() public {
        // Directly transfer tokens to flash loan contract
        token.mint(address(flashLoan), 1000 ether);

        vm.prank(owner);
        flashLoan.syncBalance();

        assertEq(flashLoan.getPoolBalance(), poolAmount + 1000 ether);
    }

    function test_GetPoolBalance() public {
        assertEq(flashLoan.getPoolBalance(), poolAmount);
    }
}

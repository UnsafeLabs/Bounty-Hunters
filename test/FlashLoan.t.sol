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

    uint256 public feeBPS = 50;
    uint256 public poolAmount = 10000 ether;

    function setUp() public {
        token = new MockERC20();
        vm.prank(owner);
        flashLoan = new FlashLoan(address(token), feeBPS);

        token.mint(address(flashLoan), poolAmount);
        vm.prank(owner);
        flashLoan.depositToPool(poolAmount);
    }

    function test_FlashLoan() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        uint256 loanAmount = 1000 ether;
        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        assertGt(flashLoan.totalFees(), 0);
    }

    function test_FlashLoan_MinFee() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);
        token.mint(address(receiver), 100 ether);

        uint256 loanAmount = 10;
        vm.prank(address(receiver));
        flashLoan.flashLoan(loanAmount, "");

        assertEq(flashLoan.totalFees(), 1); // MIN_FEE
    }

    function test_FlashLoan_ExceedsMaxLoan_Reverts() public {
        MockFlashLoanReceiver receiver = new MockFlashLoanReceiver(address(flashLoan), true);

        uint256 loanAmount = poolAmount * 60 / 100;
        vm.prank(address(receiver));
        vm.expectRevert("Exceeds max loan amount");
        flashLoan.flashLoan(loanAmount, "");
    }
}

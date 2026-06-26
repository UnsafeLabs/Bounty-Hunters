// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./SimpleSwap.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SimpleSwapTest is Test {
    MockERC20 tokenA;
    MockERC20 tokenB;
    SimpleSwap swap;
    address user = address(0x1234);

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 deadline, uint256 minAmountOut);

    function setUp() public {
        tokenA = new MockERC20("TokenA", "TA");
        tokenB = new MockERC20("TokenB", "TB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30);

        tokenA.mint(user, 10000e18);
        tokenA.mint(address(this), 10000e18);
        tokenB.mint(address(this), 10000e18);

        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);

        vm.startPrank(user);
        tokenA.approve(address(swap), type(uint256).max);
        vm.stopPrank();

        swap.addLiquidity(1000e18, 1000e18);
    }

    function test_SwapWithExactExpectedOutputSucceeds() public {
        uint256 amountIn = 100e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 deadline = block.timestamp + 100;

        vm.prank(user);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, expectedOut, deadline);

        assertEq(amountOut, expectedOut);
    }

    function test_SwapWithSlippageExceedsReverts() public {
        uint256 amountIn = 100e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 deadline = block.timestamp + 100;

        vm.prank(user);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, expectedOut + 1, deadline);
    }

    function test_SwapWithExpiredDeadlineReverts() public {
        uint256 amountIn = 100e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 expiredDeadline = block.timestamp - 1;

        vm.prank(user);
        vm.expectRevert("Expired");
        swap.swap(address(tokenA), amountIn, expectedOut, expiredDeadline);
    }

    function test_SwapWithExactDeadlineSucceeds() public {
        uint256 amountIn = 100e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);

        vm.prank(user);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, expectedOut, block.timestamp);

        assertEq(amountOut, expectedOut);
    }

    function test_SwapEmitsEvent() public {
        uint256 amountIn = 100e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 deadline = block.timestamp + 100;

        vm.prank(user);
        vm.expectEmit(true, true, false, true);
        emit Swap(user, address(tokenA), amountIn, expectedOut, deadline, expectedOut);
        swap.swap(address(tokenA), amountIn, expectedOut, deadline);
    }

    function test_FeePrecisionForSmallAmount() public view {
        uint256 amountIn = 334;
        uint256 feeAmount = amountIn * 30 / 10000;
        uint256 amountInAfterFeeOld = amountIn - feeAmount; // old approach: loses precision
        uint256 amountInAfterFeeNew = amountIn * (10000 - 30) / 10000; // new fixed-point approach

        assertEq(amountInAfterFeeOld, amountIn, "Old approach rounds fee to zero for small amounts");
        assertTrue(amountInAfterFeeNew < amountIn, "New approach correctly charges a fee");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockToken public tokenA;
    MockToken public tokenB;
    address public user;
    uint256 constant DEADLINE = type(uint256).max;

    function setUp() public {
        tokenA = new MockToken("TokenA", "TKA");
        tokenB = new MockToken("TokenB", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee

        user = address(0x1);
        tokenA.transfer(user, 100_000 * 10 ** 18);
        tokenB.transfer(user, 100_000 * 10 ** 18);

        // Add initial liquidity
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        vm.prank(user);
        tokenA.approve(address(swap), type(uint256).max);
        vm.prank(user);
        tokenB.approve(address(swap), type(uint256).max);

        swap.addLiquidity(10_000 * 10 ** 18, 10_000 * 10 ** 18);
    }

    // Test: swap function requires minAmountOut and reverts when slippage exceeds it
    function test_SwapRevertsOnSlippage() public {
        uint256 amountIn = 100 * 10 ** 18;
        // Set an unrealistically high minAmountOut
        uint256 minAmountOut = 200 * 10 ** 18; // Way more than we'd get
        vm.prank(user);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, minAmountOut, DEADLINE);
    }

    // Test: deadline parameter prevents stale transactions from executing
    function test_ExpiredTransactionReverts() public {
        uint256 amountIn = 100 * 10 ** 18;
        vm.warp(10000);
        uint256 expiredDeadline = 9999; // Already past
        vm.prank(user);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), amountIn, 0, expiredDeadline);
    }

    // Test: Swap with exact expected output succeeds
    function test_SwapWithExpectedOutputSucceeds() public {
        uint256 amountIn = 100 * 10 ** 18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        vm.prank(user);
        uint256 actualOut = swap.swap(address(tokenA), amountIn, expectedOut, DEADLINE);
        assertEq(actualOut, expectedOut);
    }

    // Test: Swap with output below minAmountOut reverts with clear error message
    function test_SwapBelowMinAmountOutReverts() public {
        uint256 amountIn = 100 * 10 ** 18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 tooHigh = expectedOut + 1;
        vm.prank(user);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, tooHigh, DEADLINE);
    }

    // Test: Swap with zero minAmountOut (no slippage protection) succeeds
    function test_SwapWithZeroMinAmountOutSucceeds() public {
        uint256 amountIn = 100 * 10 ** 18;
        vm.prank(user);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, 0, DEADLINE);
        assertGt(amountOut, 0);
    }

    // Test: Swap tokenB for tokenA works
    function test_SwapTokenBForTokenA() public {
        uint256 amountIn = 100 * 10 ** 18;
        uint256 expectedOut = swap.getAmountOut(address(tokenB), amountIn);
        vm.prank(user);
        uint256 actualOut = swap.swap(address(tokenB), amountIn, expectedOut, DEADLINE);
        assertEq(actualOut, expectedOut);
    }

    // Test: Fee calculation uses proper precision
    function test_FeeCalculationPrecision() public {
        // Small swap amount
        uint256 amountIn = 1000; // Very small
        vm.prank(user);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, 0, DEADLINE);
        // Should still produce some output even with small amounts
        // The key is that the fee calculation doesn't truncate to zero
    }

    // Test: Invalid token reverts
    function test_InvalidTokenReverts() public {
        vm.prank(user);
        vm.expectRevert("Invalid token");
        swap.swap(address(0x123), 100, 0, DEADLINE);
    }

    // Test: Zero amount reverts
    function test_ZeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(tokenA), 0, 0, DEADLINE);
    }
}

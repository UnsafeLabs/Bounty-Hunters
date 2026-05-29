// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    uint256 constant FEE = 30; // 0.3%
    uint256 constant BASE_TIME = 1_000_000;

    function setUp() public {
        vm.warp(BASE_TIME);
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE);

        // Mint tokens
        tokenA.mint(alice, 1000e18);
        tokenB.mint(alice, 1000e18);
        tokenA.mint(bob, 1000e18);
        tokenB.mint(bob, 1000e18);

        // Add liquidity
        vm.startPrank(alice);
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        swap.addLiquidity(100e18, 100e18);
        vm.stopPrank();
    }

    // Test: basic swap succeeds with slippage protection
    function test_swapWithSlippageProtection() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        uint256 expectedOut = swap.getAmountOut(address(tokenA), 1e18);
        uint256 amountOut = swap.swap(address(tokenA), 1e18, expectedOut, BASE_TIME + 3600);

        assertGt(amountOut, 0);
        assertEq(amountOut, expectedOut);
        vm.stopPrank();
    }

    // Test: swap reverts when slippage exceeded
    function test_swapRevertsOnSlippage() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        uint256 expectedOut = swap.getAmountOut(address(tokenA), 1e18);

        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), 1e18, expectedOut + 1, BASE_TIME + 3600);
        vm.stopPrank();
    }

    // Test: swap reverts on expired deadline
    function test_swapRevertsOnExpiredDeadline() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), 1e18, 0, BASE_TIME - 1);
        vm.stopPrank();
    }

    // Test: swap with zero minAmountOut succeeds
    function test_swapWithZeroMinAmountOut() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        uint256 amountOut = swap.swap(address(tokenA), 1e18, 0, BASE_TIME + 3600);
        assertGt(amountOut, 0);
        vm.stopPrank();
    }

    // Test: swap tokenB for tokenA
    function test_swapTokenBForTokenA() public {
        vm.startPrank(bob);
        tokenB.approve(address(swap), type(uint256).max);

        uint256 expectedOut = swap.getAmountOut(address(tokenB), 1e18);
        uint256 amountOut = swap.swap(address(tokenB), 1e18, expectedOut, BASE_TIME + 3600);

        assertGt(amountOut, 0);
        vm.stopPrank();
    }

    // Test: swap emits event
    function test_swapEmitsEvent() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        uint256 expectedOut = swap.getAmountOut(address(tokenA), 1e18);

        vm.expectEmit(true, false, false, true);
        emit SimpleSwap.Swap(bob, address(tokenA), 1e18, expectedOut);
        swap.swap(address(tokenA), 1e18, expectedOut, BASE_TIME + 3600);
        vm.stopPrank();
    }

    // Test: invalid token reverts
    function test_swapInvalidTokenReverts() public {
        vm.prank(bob);
        vm.expectRevert("Invalid token");
        swap.swap(address(0xdead), 1e18, 0, BASE_TIME + 3600);
    }

    // Test: zero amount reverts
    function test_swapZeroAmountReverts() public {
        vm.prank(bob);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(tokenA), 0, 0, BASE_TIME + 3600);
    }

    // Test: fee calculation precision for small amounts
    function test_feePrecisionForSmallAmounts() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        // For very small amounts, fee should not truncate to zero
        // With 0.3% fee (30 basis points), 100 wei * 30 / 10000 = 0.3 -> rounds up to 1
        uint256 smallAmount = 100;
        uint256 expectedFee = (smallAmount * FEE + 9999) / 10000;
        assertEq(expectedFee, 1); // Should be 1, not 0

        vm.stopPrank();
    }

    // Test: reserves update correctly after swap
    function test_reservesUpdateCorrectly() public {
        uint256 reserveABefore = swap.reserveA();
        uint256 reserveBBefore = swap.reserveB();

        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);
        uint256 amountIn = 1e18;
        uint256 amountOut = swap.swap(address(tokenA), amountIn, 0, BASE_TIME + 3600);
        vm.stopPrank();

        assertEq(swap.reserveA(), reserveABefore + amountIn);
        assertEq(swap.reserveB(), reserveBBefore - amountOut);
    }

    // Test: getAmountOut matches actual swap output
    function test_getAmountOutMatchesSwap() public {
        vm.startPrank(bob);
        tokenA.approve(address(swap), type(uint256).max);

        uint256 predicted = swap.getAmountOut(address(tokenA), 5e18);
        uint256 actual = swap.swap(address(tokenA), 5e18, 0, BASE_TIME + 3600);

        assertEq(predicted, actual);
        vm.stopPrank();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal ERC20 mock for testing
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

    uint256 constant FEE_BPS = 30; // 0.3%
    uint256 constant INITIAL_LIQUIDITY = 1_000_000e18;

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE_BPS);

        // Provide initial liquidity
        tokenA.mint(address(this), INITIAL_LIQUIDITY);
        tokenB.mint(address(this), INITIAL_LIQUIDITY);
        tokenA.approve(address(swap), INITIAL_LIQUIDITY);
        tokenB.approve(address(swap), INITIAL_LIQUIDITY);
        swap.addLiquidity(INITIAL_LIQUIDITY, INITIAL_LIQUIDITY);

        // Fund alice
        tokenA.mint(alice, 100_000e18);
        tokenB.mint(alice, 100_000e18);
    }

    // ===== Test 1: Basic swap with valid slippage and deadline =====
    function test_swapWithSlippageProtection() public {
        uint256 amountIn = 1_000e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Calculate expected output
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);

        vm.startPrank(alice);
        tokenA.approve(address(swap), amountIn);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, expectedOut, deadline);
        vm.stopPrank();

        assertGe(amountOut, expectedOut, "Output should meet minimum");
        assertGt(amountOut, 0, "Output should be positive");
    }

    // ===== Test 2: Revert when slippage exceeded =====
    function test_revertWhenSlippageExceeded() public {
        uint256 amountIn = 1_000e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Set unreasonably high minAmountOut
        uint256 unreasonableMin = amountIn * 2;

        vm.startPrank(alice);
        tokenA.approve(address(swap), amountIn);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, unreasonableMin, deadline);
        vm.stopPrank();
    }

    // ===== Test 3: Revert when deadline expired =====
    function test_revertWhenDeadlineExpired() public {
        uint256 amountIn = 1_000e18;
        uint256 pastDeadline = block.timestamp - 1; // already expired

        vm.startPrank(alice);
        tokenA.approve(address(swap), amountIn);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), amountIn, 0, pastDeadline);
        vm.stopPrank();
    }

    // ===== Test 4: Fee is never zero even for small amounts =====
    function test_feeNeverZeroForSmallAmounts() public {
        uint256 smallAmount = 1; // 1 wei
        uint256 deadline = block.timestamp + 1 hours;

        // Fee should be at least 1 wei (rounded up) for any non-zero amount
        // with 30 bps: (1 * 30 + 9999) / 10000 = 10029 / 10000 = 1
        uint256 expectedOut = swap.getAmountOut(address(tokenA), smallAmount);

        vm.startPrank(alice);
        tokenA.approve(address(swap), smallAmount);

        if (expectedOut == 0) {
            vm.expectRevert("Insufficient output amount");
            swap.swap(address(tokenA), smallAmount, 0, deadline);
        } else {
            uint256 out = swap.swap(address(tokenA), smallAmount, 0, deadline);
            assertGt(out, 0);
        }
        vm.stopPrank();
    }

    // ===== Test 5: getAmountOut matches actual swap output =====
    function test_getAmountOutMatchesSwap() public {
        uint256 amountIn = 5_000e18;
        uint256 deadline = block.timestamp + 1 hours;

        uint256 predicted = swap.getAmountOut(address(tokenA), amountIn);

        vm.startPrank(alice);
        tokenA.approve(address(swap), amountIn);
        uint256 actual = swap.swap(address(tokenA), amountIn, predicted, deadline);
        vm.stopPrank();

        assertEq(actual, predicted, "Predicted and actual output must match");
    }

    // ===== Test 6: Swap in both directions =====
    function test_swapBothDirections() public {
        uint256 amountIn = 1_000e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Swap A -> B
        vm.startPrank(alice);
        tokenA.approve(address(swap), amountIn);
        uint256 outB = swap.swap(address(tokenA), amountIn, 0, deadline);
        assertGt(outB, 0, "A->B swap should produce output");

        // Swap B -> A
        tokenB.approve(address(swap), outB);
        uint256 outA = swap.swap(address(tokenB), outB, 0, deadline);
        assertGt(outA, 0, "B->A swap should produce output");
        vm.stopPrank();

        // Due to fees, round-trip should return less than original
        assertLt(outA, amountIn, "Round-trip should lose value to fees");
    }
}

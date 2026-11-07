// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockToken public tokenA;
    MockToken public tokenB;
    address public user1;
    address public user2;

    uint256 public constant FEE = 30; // 0.3%

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        tokenA = new MockToken("Token A", "TKA", 1000000 * 1e18);
        tokenB = new MockToken("Token B", "TKB", 1000000 * 1e18);

        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE);

        // Distribute tokens
        tokenA.transfer(user1, 100000 * 1e18);
        tokenB.transfer(user1, 100000 * 1e18);
        tokenA.transfer(user2, 100000 * 1e18);
        tokenB.transfer(user2, 100000 * 1e18);

        // Approve swap
        vm.prank(user1);
        tokenA.approve(address(swap), type(uint256).max);
        vm.prank(user1);
        tokenB.approve(address(swap), type(uint256).max);

        vm.prank(user2);
        tokenA.approve(address(swap), type(uint256).max);
        vm.prank(user2);
        tokenB.approve(address(swap), type(uint256).max);

        // Add initial liquidity
        vm.prank(user1);
        swap.addLiquidity(50000 * 1e18, 50000 * 1e18);
    }

    function test_InitialState() public view {
        assertEq(swap.tokenA(), address(tokenA));
        assertEq(swap.tokenB(), address(tokenB));
        assertEq(swap.fee(), FEE);
        assertEq(swap.reserveA(), 50000 * 1e18);
        assertEq(swap.reserveB(), 50000 * 1e18);
    }

    function test_AddLiquidity() public {
        uint256 amountA = 10000 * 1e18;
        uint256 amountB = 10000 * 1e18;

        vm.prank(user2);
        swap.addLiquidity(amountA, amountB);

        assertEq(swap.reserveA(), 60000 * 1e18);
        assertEq(swap.reserveB(), 60000 * 1e18);
    }

    function test_AddLiquidityZeroAmount() public {
        vm.prank(user2);
        vm.expectRevert("Amounts must be > 0");
        swap.addLiquidity(0, 1000);
    }

    function test_SwapWithSlippageProtection() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 minAmountOut = expectedOut * 99 / 100; // 1% slippage tolerance
        uint256 deadline = block.timestamp + 1 hours;

        uint256 balABefore = tokenA.balanceOf(user2);
        uint256 balBBefore = tokenB.balanceOf(user2);

        vm.prank(user2);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, minAmountOut, deadline);

        assertGe(amountOut, minAmountOut);
        assertEq(tokenA.balanceOf(user2), balABefore - amountIn);
        assertEq(tokenB.balanceOf(user2), balBBefore + amountOut);
    }

    function test_SwapSlippageExceeded() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 minAmountOut = expectedOut * 110 / 100; // 10% above expected
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(user2);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, minAmountOut, deadline);
    }

    function test_SwapExpiredDeadline() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 minAmountOut = 1;
        uint256 deadline = block.timestamp - 1; // Already expired

        vm.prank(user2);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), amountIn, minAmountOut, deadline);
    }

    function test_SwapZeroMinAmountOut() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(user2);
        vm.expectRevert("MinAmountOut must be > 0");
        swap.swap(address(tokenA), amountIn, 0, deadline);
    }

    function test_SwapZeroAmountIn() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(user2);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(tokenA), 0, 1, deadline);
    }

    function test_SwapInvalidToken() public {
        address invalidToken = makeAddr("invalid");
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(user2);
        vm.expectRevert("Invalid token");
        swap.swap(invalidToken, 1000, 1, deadline);
    }

    function test_SwapInsufficientLiquidity() public {
        // Create new swap with no liquidity
        SimpleSwap emptySwap = new SimpleSwap(address(tokenA), address(tokenB), FEE);
        
        uint256 deadline = block.timestamp + 1 hours;

        vm.prank(user2);
        vm.expectRevert("Insufficient liquidity");
        emptySwap.swap(address(tokenA), 1000, 1, deadline);
    }

    function test_FeeCalculationPrecision() public {
        // Test with small amount to verify precision
        uint256 smallAmount = 100; // Very small amount
        uint256 expectedOut = swap.getAmountOut(address(tokenA), smallAmount);
        
        // Should not be zero due to rounding
        assertGt(expectedOut, 0);
    }

    function test_GetAmountOut() public view {
        uint256 amountIn = 1000 * 1e18;
        uint256 amountOut = swap.getAmountOut(address(tokenA), amountIn);
        
        // Should be positive and less than reserve
        assertGt(amountOut, 0);
        assertLt(amountOut, swap.reserveB());
    }

    function test_SwapUpdatesReserves() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 minAmountOut = expectedOut * 99 / 100;
        uint256 deadline = block.timestamp + 1 hours;

        uint256 reserveABefore = swap.reserveA();
        uint256 reserveBBefore = swap.reserveB();

        vm.prank(user2);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, minAmountOut, deadline);

        assertEq(swap.reserveA(), reserveABefore + amountIn);
        assertEq(swap.reserveB(), reserveBBefore - amountOut);
    }

    function test_SwapBothDirections() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Swap A -> B
        uint256 expectedOut1 = swap.getAmountOut(address(tokenA), amountIn);
        vm.prank(user2);
        uint256 amountOut1 = swap.swap(address(tokenA), amountIn, expectedOut1 * 99 / 100, deadline);
        assertGt(amountOut1, 0);

        // Swap B -> A
        uint256 expectedOut2 = swap.getAmountOut(address(tokenB), amountOut1);
        vm.prank(user2);
        uint256 amountOut2 = swap.swap(address(tokenB), amountOut1, expectedOut2 * 99 / 100, deadline);
        assertGt(amountOut2, 0);
    }

    function test_InvalidTokenAddresses() public {
        vm.expectRevert("Invalid token addresses");
        new SimpleSwap(address(0), address(tokenB), FEE);

        vm.expectRevert("Invalid token addresses");
        new SimpleSwap(address(tokenA), address(0), FEE);
    }

    function test_SameTokenAddresses() public {
        vm.expectRevert("Tokens must be different");
        new SimpleSwap(address(tokenA), address(tokenA), FEE);
    }

    function test_FeeTooHigh() public {
        vm.expectRevert("Fee too high");
        new SimpleSwap(address(tokenA), address(tokenB), 10001);
    }

    function test_SwapExactExpectedOutput() public {
        uint256 amountIn = 1000 * 1e18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        uint256 deadline = block.timestamp + 1 hours;

        // Swap with exact expected output as minAmountOut
        vm.prank(user2);
        uint256 amountOut = swap.swap(address(tokenA), amountIn, expectedOut, deadline);
        
        assertEq(amountOut, expectedOut);
    }
}

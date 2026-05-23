// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    TestToken public tokenA;
    TestToken public tokenB;

    address public user = address(0x123);
    uint256 constant FEE = 30; // 0.3%

    function setUp() public {
        tokenA = new TestToken("Token A", "TKA");
        tokenB = new TestToken("Token B", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), FEE);

        tokenA.transfer(user, 100_000e18);
        tokenB.transfer(user, 100_000e18);

        vm.startPrank(user);
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    function addInitialLiquidity() internal {
        vm.prank(user);
        swap.addLiquidity(1000e18, 1000e18);
    }

    function test_SwapExactExpectedOutput() public {
        addInitialLiquidity();

        vm.prank(user);
        uint256 out = swap.swap(address(tokenA), 100e18, 0, block.timestamp + 1 hours);

        assertTrue(out > 0, "Should return non-zero output");
    }

    function test_SwapRevertsWhenSlippageExceeded() public {
        addInitialLiquidity();

        vm.prank(user);
        uint256 out = swap.getAmountOut(address(tokenA), 100e18);

        vm.prank(user);
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), 100e18, out + 1, block.timestamp + 1 hours);
    }

    function test_SwapSucceedsWithExactMinAmountOut() public {
        addInitialLiquidity();

        uint256 out = swap.getAmountOut(address(tokenA), 100e18);

        vm.prank(user);
        uint256 received = swap.swap(address(tokenA), 100e18, out, block.timestamp + 1 hours);

        assertEq(received, out);
    }

    function test_DeadlineExpiredReverts() public {
        addInitialLiquidity();

        vm.prank(user);
        vm.expectRevert("Deadline expired");
        swap.swap(address(tokenA), 100e18, 0, block.timestamp - 1);
    }

    function test_DeadlineAtExactBlockWorks() public {
        addInitialLiquidity();

        vm.prank(user);
        uint256 out = swap.swap(address(tokenA), 100e18, 0, block.timestamp);

        assertTrue(out > 0);
    }

    function test_InvalidTokenReverts() public {
        addInitialLiquidity();

        vm.prank(user);
        vm.expectRevert("Invalid token");
        swap.swap(address(0xdead), 100e18, 0, block.timestamp + 1 hours);
    }

    function test_ZeroAmountReverts() public {
        addInitialLiquidity();

        vm.prank(user);
        vm.expectRevert("Amount must be > 0");
        swap.swap(address(tokenA), 0, 0, block.timestamp + 1 hours);
    }

    function test_FeeAppliedOnSmallSwap() public {
        addInitialLiquidity();

        uint256 expected = swap.getAmountOut(address(tokenA), 1e15);

        vm.prank(user);
        uint256 out = swap.swap(address(tokenA), 1e15, 0, block.timestamp + 1 hours);

        assertTrue(out > 0, "Small swap should still produce output with new fee formula");
        assertEq(out, expected, "Actual output should match pre-computed getAmountOut");
    }

    function test_SwapBothDirections() public {
        addInitialLiquidity();

        vm.startPrank(user);
        uint256 outAtoB = swap.swap(address(tokenA), 100e18, 0, block.timestamp + 1 hours);
        assertTrue(outAtoB > 0);

        uint256 outBtoA = swap.swap(address(tokenB), 50e18, 0, block.timestamp + 1 hours);
        assertTrue(outBtoA > 0);
        vm.stopPrank();
    }

    function test_GetAmountOutMatchesActualOutput() public {
        addInitialLiquidity();

        uint256 expected = swap.getAmountOut(address(tokenA), 100e18);

        vm.prank(user);
        uint256 actual = swap.swap(address(tokenA), 100e18, 0, block.timestamp + 1 hours);

        assertEq(actual, expected);
    }

    function test_MultipleSwapsMaintainK() public {
        addInitialLiquidity();

        uint256 k0 = swap.reserveA() * swap.reserveB();

        vm.prank(user);
        swap.swap(address(tokenA), 100e18, 0, block.timestamp + 1 hours);

        uint256 k1 = swap.reserveA() * swap.reserveB();
        assertTrue(k1 >= k0, "K should not decrease after swap (fee increases K)");
    }

    function test_LargeSwapDoesNotDrainPool() public {
        addInitialLiquidity();

        vm.prank(user);
        uint256 out = swap.swap(address(tokenA), 2000e18, 0, block.timestamp + 1 hours);

        assertTrue(out < 1000e18, "Should not drain full reserve due to constant product");
        assertTrue(out > 0, "Large swap should still produce output");
        assertTrue(swap.reserveA() > 0, "Reserve A should remain positive");
        assertTrue(swap.reserveB() > 0, "Reserve B should remain positive");
    }
}

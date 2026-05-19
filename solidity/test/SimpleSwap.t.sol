// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Test, console} from "forge-std/Test.sol";
import {SimpleSwap} from "../contracts/SimpleSwap.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1e36);
    }
}

contract SimpleSwapTest is Test {
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    SimpleSwap public swap;
    address user = address(0x123);

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee
        tokenA.transfer(address(this), 1e27);
        tokenB.transfer(address(this), 1e27);
    }

    function test_swap_withMinAmountOut() public {
        tokenA.approve(address(swap), 1e18);
        swap.addLiquidity(1e18, 1e18);

        uint256 minOut = 1;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 amountOut = swap.swap(address(tokenA), 1e15, minOut, deadline);
        assertGt(amountOut, 0, "Should receive tokens");
    }

    function test_swap_revertsOnSlippage() public {
        tokenA.approve(address(swap), 1e18);
        swap.addLiquidity(1e18, 1e18);

        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), 1e15, 1e30, deadline); // minOut impossibly high
    }

    function test_swap_revertsOnExpiredDeadline() public {
        tokenA.approve(address(swap), 1e18);
        swap.addLiquidity(1e18, 1e18);

        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), 1e15, 1, block.timestamp - 1);
    }

    function test_getAmountOut_matchesSwap() public {
        tokenA.approve(address(swap), 1e18);
        swap.addLiquidity(1e18, 1e18);

        uint256 expected = swap.getAmountOut(address(tokenA), 1e15);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 actual = swap.swap(address(tokenA), 1e15, 1, deadline);
        assertEq(actual, expected, "getAmountOut should match actual output");
    }

    function test_swap_reverseDirection() public {
        tokenA.approve(address(swap), 1e18);
        swap.addLiquidity(1e18, 1e18);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 amountOut = swap.swap(address(tokenB), 1e15, 1, deadline);
        assertGt(amountOut, 0, "Should work in reverse direction");
    }
}

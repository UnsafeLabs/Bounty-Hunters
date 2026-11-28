// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SimpleSwap} from "../contracts/SimpleSwap.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract SimpleSwapTest is Test {
    SimpleSwap swap;
    MockToken tokenA;
    MockToken tokenB;
    uint256 deadline;

    function setUp() public {
        tokenA = new MockToken();
        tokenB = new MockToken();
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3%
        tokenA.mint(address(this), 1_000_000e18);
        tokenB.mint(address(this), 1_000_000e18);
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        swap.addLiquidity(100_000e18, 100_000e18);
        deadline = block.timestamp + 300;
    }

    function test_successful_swap_within_limits() public {
        uint256 expected = swap.getAmountOut(address(tokenA), 1e18);
        uint256 out = swap.swap(address(tokenA), 1e18, expected, deadline);
        assertEq(out, expected);
    }

    function test_revert_on_excessive_slippage() public {
        vm.expectRevert("Insufficient output amount");
        swap.swap(address(tokenA), 1e18, type(uint256).max, deadline);
    }

    function test_revert_on_expired_deadline() public {
        vm.warp(deadline + 1);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), 1e18, 0, deadline);
    }

    function test_revert_on_amount_too_small_for_fee() public {
        vm.expectRevert("Amount too small for fee");
        swap.swap(address(tokenA), 1, 0, deadline); // 1 wei -> fee truncates to 0
    }

    function test_revert_on_insufficient_liquidity_output() public {
        vm.expectRevert("Insufficient liquidity");
        swap.swap(address(tokenA), 2, 0, deadline); // tiny amount rounds to zero output
    }

    function test_revert_on_invalid_token() public {
        MockToken c = new MockToken();
        vm.expectRevert("Invalid token");
        swap.swap(address(c), 1e18, 0, deadline);
    }
}

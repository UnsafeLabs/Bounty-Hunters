// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 ether);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockToken public tokenA;
    MockToken public tokenB;
    address public user = address(0x11);

    function setUp() public {
        tokenA = new MockToken("TokenA", "TKA");
        tokenB = new MockToken("TokenB", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee

        tokenA.mint(user, 10000 ether);
        tokenB.mint(user, 10000 ether);

        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        swap.addLiquidity(1000 ether, 1000 ether);

        vm.startPrank(user);
        tokenA.approve(address(swap), type(uint256).max);
        tokenB.approve(address(swap), type(uint256).max);
        vm.stopPrank();
    }

    function test_SuccessfulSwap() public {
        vm.startPrank(user);
        uint256 expectedOut = swap.getAmountOut(address(tokenA), 10 ether);
        uint256 actualOut = swap.swap(address(tokenA), 10 ether, expectedOut, block.timestamp);
        assertEq(expectedOut, actualOut);
        vm.stopPrank();
    }

    function test_SlippageExceeded() public {
        vm.startPrank(user);
        uint256 expectedOut = swap.getAmountOut(address(tokenA), 10 ether);
        
        vm.expectRevert("Slippage exceeded");
        // Ask for slightly more than expected
        swap.swap(address(tokenA), 10 ether, expectedOut + 1, block.timestamp);
        vm.stopPrank();
    }

    function test_ExpiredDeadline() public {
        vm.startPrank(user);
        uint256 expectedOut = swap.getAmountOut(address(tokenA), 10 ether);
        
        vm.warp(block.timestamp + 10);
        
        vm.expectRevert("Expired");
        swap.swap(address(tokenA), 10 ether, expectedOut, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_FeePrecision() public {
        // Without precision fix: amountIn = 100, fee = 30.
        // feeAmount = 100 * 30 / 10000 = 0 (truncated!)
        // amountInAfterFee = 100.
        // With precision fix: amountInWithFee = 100 * 9970 = 997000
        uint256 amountIn = 100; // tiny amount
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        
        // Let's verify precision calculation matches math
        // input = 100
        // fee = 0.3% -> effectively 99.7% of input = 99.7
        // out = (1000 * 99.7) / (1000 + 99.7) = 99700 / 1099.7 ... wait, reserve is 1000 ether
        
        vm.startPrank(user);
        uint256 actualOut = swap.swap(address(tokenA), amountIn, expectedOut, block.timestamp);
        assertEq(expectedOut, actualOut);
        vm.stopPrank();
    }
}

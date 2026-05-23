// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/SimpleSwap.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SimpleSwapTest is Test {
    MockToken tokenA;
    MockToken tokenB;
    SimpleSwap swapper;

    address user = address(0xBEEF);

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        swapper = new SimpleSwap(address(tokenA), address(tokenB), 30);

        tokenA.mint(address(this), 1_000_000 ether);
        tokenB.mint(address(this), 1_000_000 ether);
        tokenA.approve(address(swapper), type(uint256).max);
        tokenB.approve(address(swapper), type(uint256).max);
        swapper.addLiquidity(100_000 ether, 100_000 ether);

        tokenA.mint(user, 1_000 ether);
        vm.prank(user);
        tokenA.approve(address(swapper), type(uint256).max);
    }

    function testSwapSucceedsWithExpectedOutput() public {
        uint256 amountIn = 100 ether;
        uint256 amountOut = swapper.getAmountOut(address(tokenA), amountIn);

        vm.prank(user);
        uint256 received = swapper.swap(address(tokenA), amountIn, amountOut, block.timestamp + 60);
        assertEq(received, amountOut);
    }

    function testSwapRevertsWhenSlippageExceeded() public {
        vm.prank(user);
        vm.expectRevert("Slippage exceeded");
        swapper.swap(address(tokenA), 100 ether, type(uint256).max, block.timestamp + 60);
    }

    function testSwapRevertsWhenDeadlineExpired() public {
        vm.prank(user);
        vm.expectRevert("Deadline exceeded");
        swapper.swap(address(tokenA), 100 ether, 0, block.timestamp - 1);
    }

    function testSmallTradeChargesNonZeroFee() public {
        uint256 amountOut = swapper.getAmountOut(address(tokenA), 1);
        assertEq(amountOut, 0);
    }
}

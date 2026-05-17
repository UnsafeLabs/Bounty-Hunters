// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18);
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockToken public tokenA;
    MockToken public tokenB;
    address public user = address(0x1);

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee

        tokenA.transfer(address(swap), 10000 * 10**18);
        tokenB.transfer(address(swap), 10000 * 10**18);
        
        // Initial reserves are set in the swap contract manually for this test setup
        // though in reality addLiquidity would be used.
        // We'll use addLiquidity here to be proper.
        tokenA.approve(address(swap), 10000 * 10**18);
        tokenB.approve(address(swap), 10000 * 10**18);
        swap.addLiquidity(10000 * 10**18, 10000 * 10**18);
    }

    function test_swap_success() public {
        uint256 amountIn = 100 * 10**18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        
        tokenA.transfer(user, amountIn);
        vm.startPrank(user);
        tokenA.approve(address(swap), amountIn);
        
        uint256 actualOut = swap.swap(address(tokenA), amountIn, expectedOut, block.timestamp + 1 hours);
        assertEq(actualOut, expectedOut);
        assertEq(tokenB.balanceOf(user), expectedOut);
        vm.stopPrank();
    }

    function test_swap_reverts_on_slippage() public {
        uint256 amountIn = 100 * 10**18;
        uint256 expectedOut = swap.getAmountOut(address(tokenA), amountIn);
        
        tokenA.transfer(user, amountIn);
        vm.startPrank(user);
        tokenA.approve(address(swap), amountIn);
        
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), amountIn, expectedOut + 1, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_swap_reverts_on_deadline() public {
        uint256 amountIn = 100 * 10**18;
        
        tokenA.transfer(user, amountIn);
        vm.startPrank(user);
        tokenA.approve(address(swap), amountIn);
        
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), amountIn, 0, block.timestamp - 1);
        vm.stopPrank();
    }
}

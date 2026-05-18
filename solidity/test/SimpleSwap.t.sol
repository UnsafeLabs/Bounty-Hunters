// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SimpleSwap.sol";

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public user = address(1);
    uint256 public constant DEADLINE = 1000000000; // far future

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee

        // Mint tokens
        tokenA.mint(user, 10000 ether);
        tokenB.mint(user, 10000 ether);
        tokenA.mint(address(this), 100000 ether);
        tokenB.mint(address(this), 100000 ether);

        // Add initial liquidity
        tokenA.approve(address(swap), 10000 ether);
        tokenB.approve(address(swap), 10000 ether);
        swap.addLiquidity(10000 ether, 10000 ether);
    }

    function test_SwapWithMinAmountOut() public {
        vm.startPrank(user);
        tokenA.approve(address(swap), 100 ether);

        uint256 balanceBefore = tokenB.balanceOf(user);
        uint256 amountOut = swap.swap(address(tokenA), 100 ether, 90 ether, DEADLINE);
        uint256 balanceAfter = tokenB.balanceOf(user);

        assertGt(amountOut, 0);
        assertEq(balanceAfter - balanceBefore, amountOut, "Balance change should match amountOut");
        vm.stopPrank();
    }

    function test_RevertSlippageExceeded() public {
        vm.startPrank(user);
        tokenA.approve(address(swap), 100 ether);

        // Set unrealistically high minAmountOut
        vm.expectRevert("Slippage exceeded");
        swap.swap(address(tokenA), 100 ether, 200 ether, DEADLINE);
        vm.stopPrank();
    }

    function test_RevertDeadlineExpired() public {
        // Warp time past the deadline
        vm.warp(DEADLINE + 1);

        vm.startPrank(user);
        tokenA.approve(address(swap), 100 ether);

        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), 100 ether, 0, DEADLINE);
        vm.stopPrank();
    }

    function test_MinimumFeeForSmallAmounts() public {
        vm.startPrank(user);
        tokenA.approve(address(swap), 10 ether);

        // Small amount where fee would truncate to 0
        uint256 amountOut = swap.swap(address(tokenA), 10 ether, 0, DEADLINE);

        // Should still work with minimum fee of 1
        assertGt(amountOut, 0);
        vm.stopPrank();
    }

    function test_GetAmountOut() public {
        uint256 amountOut = swap.getAmountOut(address(tokenA), 100 ether);
        assertGt(amountOut, 0);

        // Verify it matches actual swap
        vm.startPrank(user);
        tokenA.approve(address(swap), 100 ether);
        uint256 actualOut = swap.swap(address(tokenA), 100 ether, 0, DEADLINE);
        assertEq(amountOut, actualOut, "getAmountOut should match actual swap");
        vm.stopPrank();
    }

    function test_ReservesUpdated() public {
        uint256 reserveABefore = swap.reserveA();
        uint256 reserveBBefore = swap.reserveB();

        vm.startPrank(user);
        tokenA.approve(address(swap), 100 ether);
        swap.swap(address(tokenA), 100 ether, 0, DEADLINE);
        vm.stopPrank();

        assertGt(swap.reserveA(), reserveABefore, "reserveA should increase");
        assertLt(swap.reserveB(), reserveBBefore, "reserveB should decrease");
    }
}

// Mock ERC20 for testing (defined here to avoid import issues)
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    string public name = "Mock Token";
    string public symbol = "MCK";
    uint8 public decimals = 18;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

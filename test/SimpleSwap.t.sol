// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/SimpleSwap.sol";

contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
}

contract SimpleSwapTest is Test {
    SimpleSwap public swap;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public owner = vm.addr(1);
    address public user = vm.addr(2);

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();

        vm.prank(owner);
        swap = new SimpleSwap(address(tokenA), address(tokenB), 30); // 0.3% fee

        tokenA.mint(user, 10000 ether);
        tokenB.mint(user, 10000 ether);
        tokenA.mint(address(swap), 1000 ether);
        tokenB.mint(address(swap), 1000 ether);

        vm.prank(user);
        tokenA.approve(address(swap), 10000 ether);
        vm.prank(user);
        tokenB.approve(address(swap), 10000 ether);
    }

    function test_Swap() public {
        vm.prank(user);
        uint256 amountOut = swap.swap(address(tokenA), 100 ether, 0, block.timestamp + 1 hours);

        assertGt(amountOut, 0);
    }

    function test_Swap_MinAmountOut_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Insufficient output amount");
        swap.swap(address(tokenA), 100 ether, 1000 ether, block.timestamp + 1 hours);
    }

    function test_Swap_Deadline_Reverts() public {
        vm.prank(user);
        vm.expectRevert("Transaction expired");
        swap.swap(address(tokenA), 100 ether, 0, block.timestamp - 1 hours);
    }
}

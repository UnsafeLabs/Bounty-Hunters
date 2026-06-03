// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../solidity/contracts/LiquidityPool.sol";

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

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public user1 = vm.addr(1);
    address public user2 = vm.addr(2);

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(user1, 10000 ether);
        tokenB.mint(user1, 10000 ether);
        tokenA.mint(user2, 10000 ether);
        tokenB.mint(user2, 10000 ether);

        vm.prank(user1);
        tokenA.approve(address(pool), 10000 ether);
        vm.prank(user1);
        tokenB.approve(address(pool), 10000 ether);
        vm.prank(user2);
        tokenA.approve(address(pool), 10000 ether);
        vm.prank(user2);
        tokenB.approve(address(pool), 10000 ether);
    }

    function test_AddLiquidity_Initial() public {
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(1000 ether, 1000 ether);
        assertGt(lpTokens, 0);
    }

    function test_AddLiquidity_FirstDepositorProtection() public {
        vm.prank(user1);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1);
    }

    function test_RemoveLiquidity() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        uint256 lpBalance = pool.balanceOf(user1);
        vm.prank(user1);
        pool.removeLiquidity(lpBalance);

        assertEq(pool.balanceOf(user1), 0);
    }

    function test_Sync() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        tokenA.mint(address(pool), 500 ether);
        pool.sync();

        assertEq(pool.reserveA(), tokenA.balanceOf(address(pool)));
    }
}

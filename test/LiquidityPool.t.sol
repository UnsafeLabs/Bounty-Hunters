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

    function test_Constructor() public {
        assertEq(address(pool.tokenA()), address(tokenA));
        assertEq(address(pool.tokenB()), address(tokenB));
    }

    function test_AddLiquidity_Initial() public {
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(1000 ether, 1000 ether);

        assertGt(lpTokens, 0);
        assertEq(pool.reserveA(), 1000 ether);
        assertEq(pool.reserveB(), 1000 ether);
    }

    function test_AddLiquidity_FirstDepositorProtection() public {
        // First deposit must be > MINIMUM_LIQUIDITY
        vm.prank(user1);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1);
    }

    function test_AddLiquidity_Subsequent() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        vm.prank(user2);
        uint256 lpTokens = pool.addLiquidity(500 ether, 500 ether);

        assertGt(lpTokens, 0);
    }

    function test_RemoveLiquidity() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        uint256 lpBalance = pool.balanceOf(user1);
        vm.prank(user1);
        pool.removeLiquidity(lpBalance);

        assertEq(pool.balanceOf(user1), 0);
    }

    function test_RemoveLiquidity_InsufficientLP_Reverts() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        vm.prank(user2);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(1);
    }

    function test_Sync() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        // Directly transfer tokens to pool (donation attack)
        tokenA.mint(address(pool), 500 ether);

        // Reserves are out of sync
        assertNe(pool.reserveA(), tokenA.balanceOf(address(pool)));

        pool.sync();

        // Reserves are now synced
        assertEq(pool.reserveA(), tokenA.balanceOf(address(pool)));
    }

    function test_GetReserves() public {
        vm.prank(user1);
        pool.addLiquidity(1000 ether, 1000 ether);

        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        assertEq(reserveA, 1000 ether);
        assertEq(reserveB, 1000 ether);
    }
}

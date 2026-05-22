// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/LiquidityPool.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MCK";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract LiquidityPoolTest {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public attacker = address(0x3);

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);
        tokenA.mint(attacker, 1_000_000 ether);
        tokenB.mint(attacker, 1_000_000 ether);
    }

    function _approveAndAddLiquidity(
        address user,
        uint256 amountA,
        uint256 amountB
    ) internal returns (uint256 lpTokens) {
        vm.startPrank(user);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        lpTokens = pool.addLiquidity(amountA, amountB);
        vm.stopPrank();
    }

    function testFirstDepositLocksMinimumLiquidity() public {
        uint256 amountA = 1000 ether;
        uint256 amountB = 1000 ether;

        _approveAndAddLiquidity(alice, amountA, amountB);

        assertEq(pool.balanceOf(address(0)), 1000);
    }

    function testMinimumDepositMustExceedLock() public {
        uint256 tinyAmount = 1;

        vm.startPrank(alice);
        tokenA.approve(address(pool), tinyAmount);
        tokenB.approve(address(pool), tinyAmount);
        vm.expectRevert();
        pool.addLiquidity(tinyAmount, tinyAmount);
        vm.stopPrank();
    }

    function testProportionalMintingOnSubsequentDeposits() public {
        _approveAndAddLiquidity(alice, 1000 ether, 1000 ether);

        uint256 secondA = 500 ether;
        uint256 secondB = 500 ether;

        vm.startPrank(bob);
        tokenA.approve(address(pool), secondA);
        tokenB.approve(address(pool), secondB);
        uint256 bobLp = pool.addLiquidity(secondA, secondB);
        vm.stopPrank();

        uint256 totalSupply = pool.totalSupply();
        uint256 expectedShare = totalSupply * secondA / pool.reserveA();
        assertApproxEqAbs(bobLp, expectedShare, 1);
    }

    function testRemoveLiquidityUsesInternalReserves() public {
        _approveAndAddLiquidity(alice, 1000 ether, 1000 ether);

        uint256 lpToRemove = 500 ether;
        vm.startPrank(alice);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpToRemove);
        vm.stopPrank();

        uint256 totalSupply = pool.totalSupply();
        assertApproxEqAbs(amountA, lpToRemove * pool.reserveA() / totalSupply, 1);
        assertApproxEqAbs(amountB, lpToRemove * pool.reserveB() / totalSupply, 1);
    }

    function testDirectTransferDoesNotAffectRemoveLiquidity() public {
        _approveAndAddLiquidity(alice, 1000 ether, 1000 ether);

        uint256 extraA = 100 ether;
        tokenA.mint(address(pool), extraA);

        uint256 lpToRemove = 500 ether;
        uint256 preReserveA = pool.reserveA();
        uint256 totalSupply = pool.totalSupply();
        uint256 expectedA = lpToRemove * preReserveA / totalSupply;
        uint256 expectedB = lpToRemove * pool.reserveB() / totalSupply;

        vm.startPrank(alice);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpToRemove);
        vm.stopPrank();

        assertEq(amountA, expectedA);
        assertEq(amountB, expectedB);
    }

    function testSyncUpdatesReserves() public {
        _approveAndAddLiquidity(alice, 1000 ether, 1000 ether);

        uint256 donatedA = 500 ether;
        tokenA.mint(address(pool), donatedA);

        assertEq(pool.reserveA(), 1000 ether);

        pool.sync();

        assertEq(pool.reserveA(), 1000 ether + 500 ether);
        assertEq(pool.reserveB(), 1000 ether);
    }

    function testPriceManipulationViaTeenyFirstDepositReverts() public {
        vm.startPrank(attacker);
        tokenA.approve(address(pool), 1);
        tokenB.approve(address(pool), 1);
        vm.expectRevert();
        pool.addLiquidity(1, 1);
        vm.stopPrank();
    }

    function testCanRemoveAllOwnedLiquidity() public {
        uint256 amountA = 2000 ether;
        uint256 amountB = 2000 ether;
        uint256 lpReceived = _approveAndAddLiquidity(alice, amountA, amountB);

        vm.startPrank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpReceived);
        vm.stopPrank();

        assertEq(pool.balanceOf(alice), 0);
        assertTrue(outA > 0);
        assertTrue(outB > 0);
    }

    function testCannotRemoveMoreThanOwned() public {
        _approveAndAddLiquidity(alice, 1000 ether, 1000 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(1);
    }
}

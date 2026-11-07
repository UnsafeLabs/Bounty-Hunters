// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockToken public tokenA;
    MockToken public tokenB;
    address public user1;
    address public user2;
    address public attacker;

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        attacker = makeAddr("attacker");

        tokenA = new MockToken("Token A", "TKA", 1000000 * 1e18);
        tokenB = new MockToken("Token B", "TKB", 1000000 * 1e18);

        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Distribute tokens
        tokenA.transfer(user1, 100000 * 1e18);
        tokenB.transfer(user1, 100000 * 1e18);
        tokenA.transfer(user2, 100000 * 1e18);
        tokenB.transfer(user2, 100000 * 1e18);
        tokenA.transfer(attacker, 100000 * 1e18);
        tokenB.transfer(attacker, 100000 * 1e18);

        // Approve pool
        vm.prank(user1);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(user1);
        tokenB.approve(address(pool), type(uint256).max);

        vm.prank(user2);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(user2);
        tokenB.approve(address(pool), type(uint256).max);

        vm.prank(attacker);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(attacker);
        tokenB.approve(address(pool), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(pool.tokenA(), address(tokenA));
        assertEq(pool.tokenB(), address(tokenB));
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.totalSupply(), 0);
        assertEq(pool.MINIMUM_LIQUIDITY(), 1000);
    }

    function test_FirstDepositLocksMinimumLiquidity() public {
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        // Expected: sqrt(10000 * 10000) = 10000
        uint256 expectedTotal = 10000 * 1e18;
        assertEq(pool.totalSupply(), expectedTotal);
        
        // MINIMUM_LIQUIDITY should be locked at address(0)
        assertEq(pool.balanceOf(address(0)), 1000);
        
        // user1 should receive total - MINIMUM_LIQUIDITY
        assertEq(pool.balanceOf(user1), expectedTotal - 1000);
        
        // Reserves should be updated
        assertEq(pool.reserveA(), 10000 * 1e18);
        assertEq(pool.reserveB(), 10000 * 1e18);
    }

    function test_FirstDepositInsufficientLiquidity() public {
        vm.prank(user1);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(10, 10); // sqrt(100) = 10 < 1000
    }

    function test_SubsequentDepositsProportional() public {
        // First deposit
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        uint256 initialSupply = pool.totalSupply();
        uint256 initialReserveA = pool.reserveA();

        // Second deposit (same ratio)
        vm.prank(user2);
        uint256 lpTokens = pool.addLiquidity(5000 * 1e18, 5000 * 1e18);

        // Should receive proportional amount
        uint256 expectedLp = 5000 * 1e18 * initialSupply / initialReserveA;
        assertEq(lpTokens, expectedLp);
        
        assertEq(pool.reserveA(), 15000 * 1e18);
        assertEq(pool.reserveB(), 15000 * 1e18);
    }

    function test_RemoveLiquidity() public {
        // Add liquidity
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        uint256 lpBalance = pool.balanceOf(user1);
        uint256 reserveA = pool.reserveA();
        uint256 reserveB = pool.reserveB();

        // Remove half
        uint256 lpToRemove = lpBalance / 2;
        
        uint256 balABefore = tokenA.balanceOf(user1);
        uint256 balBBefore = tokenB.balanceOf(user1);

        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpToRemove);

        // Should receive proportional amounts
        uint256 expectedA = lpToRemove * reserveA / pool.totalSupply();
        uint256 expectedB = lpToRemove * reserveB / pool.totalSupply();
        
        assertEq(amountA, expectedA);
        assertEq(amountB, expectedB);
        assertEq(tokenA.balanceOf(user1) - balABefore, expectedA);
        assertEq(tokenB.balanceOf(user1) - balBBefore, expectedB);
    }

    function test_RemoveLiquidityUsesReservesNotBalance() public {
        // Add liquidity
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        // Donate tokens directly (simulating donation attack)
        tokenA.transfer(address(pool), 5000 * 1e18);
        tokenB.transfer(address(pool), 5000 * 1e18);

        // Pool balance is now higher than reserves
        assertEq(tokenA.balanceOf(address(pool)), 15000 * 1e18);
        assertEq(pool.reserveA(), 10000 * 1e18); // Reserves unchanged

        uint256 lpBalance = pool.balanceOf(user1);
        
        uint256 balABefore = tokenA.balanceOf(user1);
        uint256 balBBefore = tokenB.balanceOf(user1);

        // Remove liquidity
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpBalance);

        // Should receive based on reserves, not balance (prevents attack)
        assertEq(amountA, 10000 * 1e18); // Based on reserveA, not 15000
        assertEq(amountB, 10000 * 1e18); // Based on reserveB, not 15000
    }

    function test_PriceManipulationAttackFails() public {
        // Attacker tries to manipulate price with tiny first deposit
        vm.prank(attacker);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1); // sqrt(1) = 1 < 1000
    }

    function test_DonationAttackAndRecovery() public {
        // First deposit
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        // Donation attack: send tokens directly
        tokenA.transfer(address(pool), 100000 * 1e18);
        
        // Reserves don't reflect donation
        assertEq(pool.reserveA(), 10000 * 1e18);
        assertEq(tokenA.balanceOf(address(pool)), 110000 * 1e18);

        // Sync to update reserves
        pool.sync();
        
        // Now reserves match balance
        assertEq(pool.reserveA(), 110000 * 1e18);
    }

    function test_SyncFunction() public {
        // Add liquidity
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        // Transfer tokens directly
        tokenA.transfer(address(pool), 5000 * 1e18);
        tokenB.transfer(address(pool), 3000 * 1e18);

        // Reserves unchanged
        assertEq(pool.reserveA(), 10000 * 1e18);
        assertEq(pool.reserveB(), 10000 * 1e18);

        // Sync updates reserves
        pool.sync();
        
        assertEq(pool.reserveA(), 15000 * 1e18);
        assertEq(pool.reserveB(), 13000 * 1e18);
    }

    function test_SyncEmitsEvent() public {
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        tokenA.transfer(address(pool), 5000 * 1e18);

        vm.expectEmit(false, false, false, true);
        emit Sync(15000 * 1e18, 10000 * 1e18);
        pool.sync();
    }

    function test_CannotRemoveZeroLiquidity() public {
        vm.prank(user1);
        vm.expectRevert("Must burn > 0");
        pool.removeLiquidity(0);
    }

    function test_CannotRemoveMoreThanBalance() public {
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        uint256 lpBalance = pool.balanceOf(user1);
        
        vm.prank(user1);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(lpBalance + 1);
    }

    function test_InvalidTokenAddresses() public {
        vm.expectRevert("Invalid token addresses");
        new LiquidityPool(address(0), address(tokenB));

        vm.expectRevert("Invalid token addresses");
        new LiquidityPool(address(tokenA), address(0));
    }

    function test_SameTokenAddresses() public {
        vm.expectRevert("Tokens must be different");
        new LiquidityPool(address(tokenA), address(tokenA));
    }

    function test_ZeroAmounts() public {
        vm.prank(user1);
        vm.expectRevert("Amounts must be > 0");
        pool.addLiquidity(0, 1000);

        vm.prank(user1);
        vm.expectRevert("Amounts must be > 0");
        pool.addLiquidity(1000, 0);
    }

    function test_MultipleDepositsAndWithdrawals() public {
        // user1 adds liquidity
        vm.prank(user1);
        pool.addLiquidity(10000 * 1e18, 10000 * 1e18);

        // user2 adds liquidity
        vm.prank(user2);
        pool.addLiquidity(5000 * 1e18, 5000 * 1e18);

        // user1 removes half
        uint256 user1Lp = pool.balanceOf(user1);
        vm.prank(user1);
        pool.removeLiquidity(user1Lp / 2);

        // user2 removes all
        uint256 user2Lp = pool.balanceOf(user2);
        vm.prank(user2);
        pool.removeLiquidity(user2Lp);

        // Verify final state
        assertGt(pool.reserveA(), 0);
        assertGt(pool.reserveB(), 0);
    }
}

event Sync(uint256 reserveA, uint256 reserveB);

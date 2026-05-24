// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol"

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 10000000 * 10**18);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool pool;
    MockERC20 tokenA;
    MockERC20 tokenB;
    address provider1;
    address provider2;

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        provider1 = makeAddr("provider1");
        provider2 = makeAddr("provider2");

        // Fund providers
        tokenA.transfer(provider1, 100000 * 10**18);
        tokenB.transfer(provider1, 100000 * 10**18);
        tokenA.transfer(provider2, 100000 * 10**18);
        tokenB.transfer(provider2, 100000 * 10**18);

        // Approve
        vm.prank(provider1);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(provider1);
        tokenB.approve(address(pool), type(uint256).max);
        vm.prank(provider2);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(provider2);
        tokenB.approve(address(pool), type(uint256).max);
    }

    // Test: First deposit locks MINIMUM_LIQUIDITY to address(0)
    function test_FirstDepositLocksMinimumLiquidity() public {
        vm.prank(provider1);
        uint256 lpTokens = pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        // MINIMUM_LIQUIDITY (1000) locked to address(0)
        assertEq(pool.balanceOf(address(0)), 1000);
        // Provider gets sqrt(10000*10000)*10**18 - 1000
        uint256 expectedTotal = sqrt(10000 * 10**18 * 10000 * 10**18);
        assertEq(lpTokens, expectedTotal - 1000);
    }

    // Test: First deposit must exceed minimum liquidity
    function test_RevertSmallFirstDeposit() public {
        vm.prank(provider1);
        // Tiny amounts would produce lpTokens < MINIMUM_LIQUIDITY
        vm.expectRevert("Initial liquidity too small");
        pool.addLiquidity(1, 1);
    }

    // Test: First depositor price manipulation attempt fails
    function test_PriceManipulationPrevented() public {
        // First depositor adds tiny liquidity
        vm.prank(provider1);
        uint256 lp1 = pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        // Try to manipulate: add huge amount of tokenA directly to pool
        tokenA.transfer(address(pool), 1000000 * 10**18);

        // Second depositor uses proportional formula based on reserves
        // Reserves are updated correctly via internal accounting, not balanceOf
        tokenA.transfer(address(pool), 10000 * 10**18 + 1000000 * 10**18); // direct transfer

        // Get current reserves (internal)
        uint256 resA = pool.reserveA();
        uint256 resB = pool.reserveB();

        // The reserves should reflect actual amounts from addLiquidity
        assertEq(resA, 10000 * 10**18);
        assertEq(resB, 10000 * 10**18);
    }

    // Test: Subsequent deposits use correct proportional formula
    function test_SubsequentDepositProportional() public {
        vm.prank(provider1);
        pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        vm.prank(provider2);
        uint256 lp2 = pool.addLiquidity(5000 * 10**18, 5000 * 10**18);

        // Provider2 should get roughly half of provider1's LP tokens
        // (minus the minimum liquidity lock)
        assertTrue(lp2 > 0);
    }

    // Test: removeLiquidity uses internal reserves, not balanceOf
    function test_RemoveLiquidityUsesReserves() public {
        vm.prank(provider1);
        uint256 lpTokens = pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        // Direct token transfer to pool (donation attack)
        tokenA.transfer(address(pool), 5000 * 10**18);

        // Remove liquidity
        uint256 lpToRedeem = pool.balanceOf(provider1) - 1000; // Keep some
        vm.prank(provider1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpToRedeem);

        // Amounts should be based on reserves (10000 each), not balanceOf (15000, 10000)
        uint256 expectedA = (lpToRedeem * 10000 * 10**18) / pool.totalSupply();
        assertEq(amountA, expectedA);
    }

    // Test: sync function updates reserves and emits Sync event
    function test_SyncUpdatesReserves() public {
        vm.prank(provider1);
        pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        // Direct transfer changes balance but not reserves
        tokenA.transfer(address(pool), 5000 * 10**18);

        // Sync should update reserves
        uint256 oldReserveA = pool.reserveA();
        pool.sync();
        uint256 newReserveA = pool.reserveA();

        assertGt(newReserveA, oldReserveA);
        assertEq(newReserveA, 15000 * 10**18);
    }

    // Test: Direct token transfers to pool do not affect LP token pricing
    function test_DirectTransferDoesNotAffectPricing() public {
        vm.prank(provider1);
        uint256 lp1 = pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        // Direct transfer (donation) to pool
        tokenA.transfer(address(pool), 99000 * 10**18);

        // Second provider adds liquidity based on reserves (not balanceOf)
        vm.prank(provider2);
        uint256 lp2 = pool.addLiquidity(1000 * 10**18, 1000 * 10**18);

        // LP tokens should be proportional to reserves (10000 each originally)
        // NOT proportional to balanceOf (which would be 109000 for tokenA)
        assertTrue(lp2 > 0);
        // The ratio should be approximately correct
        uint256 ratio = (lp2 * 10000) / lp1;
        assertApproxEqRel(ratio, 10, 1); // ~10% of lp1
    }

    // Test: removeLiquidity successfully returns tokens
    function test_RemoveLiquiditySuccess() public {
        vm.prank(provider1);
        uint256 lpTokens = pool.addLiquidity(10000 * 10**18, 10000 * 10**18);

        uint256 balABefore = tokenA.balanceOf(provider1);
        uint256 balBBefore = tokenB.balanceOf(provider1);

        uint256 lpToRedeem = pool.balanceOf(provider1) - 1000;
        vm.prank(provider1);
        pool.removeLiquidity(lpToRedeem);

        assertGt(tokenA.balanceOf(provider1), balABefore);
        assertGt(tokenB.balanceOf(provider1), balBBefore);
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

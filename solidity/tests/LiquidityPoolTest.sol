// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "../mocks/MockERC20.sol";

/// @title LiquidityPoolTest - Tests for first-depositor manipulation fix
contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public attacker = address(0xBAD);

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpTokens);
    event Sync(uint256 reserveA, uint256 reserveB);

    function setUp() public {
        tokenA = new MockERC20("TokenA", "TKA", 18);
        tokenB = new MockERC20("TokenB", "TKB", 18);
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Fund users
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);
        tokenA.mint(attacker, 1_000_000 ether);
        tokenB.mint(attacker, 1_000_000 ether);

        // Approve pool
        vm.prank(alice);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        tokenB.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        tokenB.approve(address(pool), type(uint256).max);
        vm.prank(attacker);
        tokenA.approve(address(pool), type(uint256).max);
        vm.prank(attacker);
        tokenB.approve(address(pool), type(uint256).max);
    }

    // =============================================
    // First deposit lock tests
    // =============================================

    function test_firstDeposit_locksMinimumLiquidity() public {
        uint256 depositA = 10_000 ether;
        uint256 depositB = 10_000 ether;

        vm.prank(alice);
        uint256 lpTokens = pool.addLiquidity(depositA, depositB);

        // Total supply should include the locked MINIMUM_LIQUIDITY
        uint256 expectedTotal = sqrt(depositA * depositB);
        assertEq(pool.totalSupply(), expectedTotal, "Total supply should equal sqrt product");
        // Alice gets sqrt - MINIMUM_LIQUIDITY
        assertEq(lpTokens, expectedTotal - MINIMUM_LIQUIDITY, "LP tokens should be minus minimum liquidity");
        // address(0) holds the locked minimum
        assertEq(pool.balanceOf(address(0)), MINIMUM_LIQUIDITY, "address(0) should hold MINIMUM_LIQUIDITY");
        assertEq(pool.balanceOf(alice), lpTokens, "Alice should hold the rest");
    }

    function test_firstDeposit_revertsIfTooSmall() public {
        // Depositing so little that sqrt < MINIMUM_LIQUIDITY should revert
        // sqrt(1 * 1) = 1 < 1000
        vm.prank(alice);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1);
    }

    // =============================================
    // Price manipulation attempt tests
    // =============================================

    function test_firstDepositorManipulation_blocked() public {
        // ATTACK SCENARIO (without fix):
        // 1. Attacker deposits tiny amount (1 wei each) -> gets 1 LP token
        // 2. Attacker donates large amount directly to pool
        // 3. Attacker withdraws LP -> gets huge amount due to inflated reserves
        //
        // WITH FIX: Step 1 fails because sqrt(1*1) = 1 < MINIMUM_LIQUIDITY

        vm.prank(attacker);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(1, 1);
    }

    function test_firstDepositorManipulation_withSufficientDeposit() public {
        // Even with a larger deposit, the locked MINIMUM_LIQUIDITY prevents
        // the attacker from controlling 100% of the LP supply

        uint256 smallDeposit = 10_001 ether; // sqrt(~10000e36) ~ 10000e18

        vm.prank(attacker);
        uint256 lpTokens = pool.addLiquidity(smallDeposit, smallDeposit);

        // Attacker does NOT control all LP — address(0) has MINIMUM_LIQUIDITY
        assertTrue(lpTokens < pool.totalSupply(), "Attacker should not control all LP");
        assertEq(pool.balanceOf(address(0)), MINIMUM_LIQUIDITY, "Dead shares exist");

        // Donate large amount to pool to inflate price
        tokenA.mint(address(pool), 1_000_000 ether);
        tokenB.mint(address(pool), 1_000_000 ether);

        // Attacker tries to remove liquidity — they should get proportional share
        // of reserves (which still uses internal reserves, not manipulated balance)
        vm.prank(attacker);
        pool.removeLiquidity(lpTokens);

        // The attacker gets only their proportional share of reserves
        // The donated tokens are NOT accounted for in reserves (they were minted directly)
        // So the attacker can't steal the donation
        assertEq(pool.reserveA(), 0, "Reserves should be 0 after full withdrawal");
        assertEq(pool.reserveB(), 0, "Reserves should be 0 after full withdrawal");
    }

    // =============================================
    // Donation attack via direct transfer
    // =============================================

    function test_directTransfer_doesNotAffectPricing() public {
        // Normal deposit
        vm.prank(alice);
        pool.addLiquidity(100 ether, 100 ether);

        // Attacker sends tokens directly to pool (donation attack)
        tokenA.mint(address(pool), 1000 ether);

        // Bob deposits — should use internal reserves, not balanceOf
        vm.prank(bob);
        uint256 bobLP = pool.addLiquidity(100 ether, 100 ether);

        // Bob should get LP proportional to reserves (100 ether), not balance (1100 ether)
        // If balanceOf were used, Bob would get much fewer LP tokens
        // With reserves, Bob should get ~same LP as Alice's initial minus MINIMUM_LIQUIDITY
        uint256 aliceLP = pool.balanceOf(alice);
        assertEq(bobLP, aliceLP, "Bob should get same LP as Alice for same deposit");
    }

    function test_removeLiquidity_usesReserves() public {
        vm.prank(alice);
        pool.addLiquidity(100 ether, 100 ether);

        // Donation: send extra tokens directly
        tokenA.mint(address(pool), 50 ether);

        uint256 aliceLP = pool.balanceOf(alice);

        // If removeLiquidity used balanceOf, alice would get more than her share
        vm.prank(alice);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(aliceLP);

        // Should get proportional to reserves (100 ether each), not balance (150 ether A, 100 ether B)
        // amountA = aliceLP * 100 ether / totalSupply
        assertEq(amountA + amountB, 200 ether, "Should get proportional to reserves");
    }

    // =============================================
    // Sync function tests
    // =============================================

    function test_sync_updatesReserves() public {
        vm.prank(alice);
        pool.addLiquidity(100 ether, 100 ether);

        // Donation
        tokenA.mint(address(pool), 50 ether);
        tokenB.mint(address(pool), 30 ether);

        // Reserves don't match balances
        assertEq(pool.reserveA(), 100 ether);
        assertTrue(tokenA.balanceOf(address(pool)) > pool.reserveA());

        // Sync updates reserves
        pool.sync();

        assertEq(pool.reserveA(), 150 ether, "ReserveA should match balance after sync");
        assertEq(pool.reserveB(), 130 ether, "ReserveB should match balance after sync");
    }

    function test_sync_emitsEvent() public {
        vm.prank(alice);
        pool.addLiquidity(100 ether, 100 ether);

        tokenA.mint(address(pool), 50 ether);

        vm.expectEmit(true, false, false, true);
        emit Sync(150 ether, 100 ether);
        pool.sync();
    }

    // =============================================
    // Subsequent deposits use correct formula
    // =============================================

    function test_subsequentDeposits_proportional() public {
        vm.prank(alice);
        pool.addLiquidity(100 ether, 100 ether);

        uint256 totalBefore = pool.totalSupply();

        vm.prank(bob);
        uint256 bobLP = pool.addLiquidity(50 ether, 50 ether);

        // Bob should get 50% of what Alice got (minus dead shares)
        uint256 aliceLP = pool.balanceOf(alice);
        assertEq(bobLP, aliceLP / 2, "Bob should get half of Alice LP for half deposit");
    }

    // =============================================
    // Helper
    // =============================================

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

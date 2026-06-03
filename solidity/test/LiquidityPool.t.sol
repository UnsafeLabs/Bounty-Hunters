// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────
// Mock ERC20 for testing
// ─────────────────────────────────────────────
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockToken public tokenA;
    MockToken public tokenB;

    address public alice;
    address public bob;
    address public carol;
    address public attacker;

    uint256 constant DEPOSIT_A = 100_000e18;
    uint256 constant DEPOSIT_B = 100_000e18;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        attacker = makeAddr("attacker");

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Distribute tokens to test users
        uint256 amount = 500_000e18;
        tokenA.transfer(alice, amount);
        tokenB.transfer(alice, amount);
        tokenA.transfer(bob, amount);
        tokenB.transfer(bob, amount);
        tokenA.transfer(carol, amount);
        tokenB.transfer(carol, amount);
        tokenA.transfer(attacker, amount);
        tokenB.transfer(attacker, amount);
    }

    // ─────────────────────────────────────────────
    // Helper: approve and add liquidity
    // ─────────────────────────────────────────────
    function _addLiquidity(address user, uint256 amountA, uint256 amountB) internal returns (uint256) {
        vm.prank(user);
        tokenA.approve(address(pool), amountA);
        vm.prank(user);
        tokenB.approve(address(pool), amountB);
        vm.prank(user);
        return pool.addLiquidity(amountA, amountB);
    }

    function _removeLiquidity(address user, uint256 lpTokens) internal returns (uint256, uint256) {
        vm.prank(user);
        return pool.removeLiquidity(lpTokens);
    }

    // ═══════════════════════════════════════════
    // FIRST DEPOSIT LOCK
    // ═══════════════════════════════════════════

    function test_firstDeposit_locksMinimumLiquidity() public {
        uint256 lpTokens = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // LP tokens = sqrt(100000e18 * 100000e18) - MINIMUM_LIQUIDITY
        uint256 expected = sqrt(DEPOSIT_A * DEPOSIT_B) - pool.MINIMUM_LIQUIDITY();
        assertEq(lpTokens, expected, "First deposit LP tokens incorrect");
        assertEq(pool.balanceOf(alice), expected, "Alice LP balance incorrect");

        // MINIMUM_LIQUIDITY locked to address(0)
        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY(), "MINIMUM_LIQUIDITY not locked to address(0)");
    }

    function test_firstDeposit_firstDepositorReceivesLpMinusLockedAmount() public {
        uint256 lpTokens = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 rawSqrt = sqrt(DEPOSIT_A * DEPOSIT_B);

        assertEq(lpTokens, rawSqrt - pool.MINIMUM_LIQUIDITY(), "First depositor should get LP minus MINIMUM_LIQUIDITY");
    }

    function test_firstDeposit_tinyDeposit_reverts() public {
        // Attacker tries to deposit 1 wei of each token
        vm.prank(attacker);
        tokenA.approve(address(pool), 1);
        vm.prank(attacker);
        tokenB.approve(address(pool), 1);
        vm.prank(attacker);
        vm.expectRevert("Insufficient first-deposit liquidity");
        pool.addLiquidity(1, 1);
    }

    function test_firstDeposit_atBoundary_reverts() public {
        // sqrt(1000 * 1000) = 1000 which is NOT > MINIMUM_LIQUIDITY (1000)
        vm.prank(attacker);
        tokenA.approve(address(pool), 1000);
        vm.prank(attacker);
        tokenB.approve(address(pool), 1000);
        vm.prank(attacker);
        vm.expectRevert("Insufficient first-deposit liquidity");
        pool.addLiquidity(1000, 1000);
    }

    function test_firstDeposit_justAboveBoundary_succeeds() public {
        // sqrt(1001 * 1001) = 1001 > 1000, so 1 LP minted to depositor
        uint256 lp = _addLiquidity(alice, 1001, 1001);
        assertEq(lp, 1, "Should get 1 LP at exact boundary");
        assertEq(pool.balanceOf(address(0)), 1000, "1000 should be locked");
    }

    // ═══════════════════════════════════════════
    // SUBSEQUENT DEPOSITS USE PROPORTIONAL FORMULA
    // ═══════════════════════════════════════════

    function test_secondDeposit_usesProportionalFormula() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Bob deposits same amounts — should get LP proportional to existing supply
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Bob's LP = amountA * totalSupply / reserveA
        uint256 totalAfterAlice = sqrt(DEPOSIT_A * DEPOSIT_B); // includes MINIMUM_LIQUIDITY at address(0)
        uint256 expectedBobLP = DEPOSIT_A * totalAfterAlice / DEPOSIT_A;
        assertEq(bobLP, expectedBobLP, "Second deposit LP tokens incorrect");
    }

    function test_multipleDepositors_fairLPTokens() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);
        uint256 carolLP = _addLiquidity(carol, DEPOSIT_A, DEPOSIT_B);

        // Bob and Carol should get the same LP tokens (same deposit, same reserves)
        assertEq(bobLP, carolLP, "Bob and Carol should get same LP for same deposit");

        // Alice's LP should be close to Bob's but slightly different due to MINIMUM_LIQUIDITY
        assertApproxEqAbs(aliceLP, bobLP, pool.MINIMUM_LIQUIDITY(), "Alice and Bob LP should be approximately equal");
    }

    // ═══════════════════════════════════════════
    // REMOVE LIQUIDITY USES INTERNAL RESERVES
    // ═══════════════════════════════════════════

    function test_removeLiquidity_usesReservesNotBalanceOf() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Someone donates tokens directly to the pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Alice's withdrawal should NOT be affected by the donation
        // because removeLiquidity uses reserves, not balanceOf
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice should get back approximately her original deposit (based on reserves)
        // NOT the inflated balance that includes the donation
        assertApproxEqAbs(amountA, DEPOSIT_A, 1e15, "Alice should get ~original deposit, not inflated amount");
        assertApproxEqAbs(amountB, DEPOSIT_B, 1e15, "Alice should get ~original deposit, not inflated amount");
    }

    function test_removeLiquidity_happyPath() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        assertGt(amountA, 0, "Should receive tokenA");
        assertGt(amountB, 0, "Should receive tokenB");
    }

    function test_removeLiquidity_zeroTokens_reverts() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        vm.prank(alice);
        vm.expectRevert("Must burn > 0");
        pool.removeLiquidity(0);
    }

    function test_removeLiquidity_insufficientTokens_reverts() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        vm.prank(bob);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(1);
    }

    // ═══════════════════════════════════════════
    // PRICE MANIPULATION ATTEMPT
    // ═══════════════════════════════════════════

    /// @dev Classic attack: deposit tiny amount, then donate to inflate share price.
    ///      With MINIMUM_LIQUIDITY lock, the attacker must deposit enough that
    ///      sqrt(amountA * amountB) > MINIMUM_LIQUIDITY, making the attack expensive.
    function test_priceManipulation_attackIsUnprofitable() public {
        // Attacker deposits minimum viable amount (1001 * 1001 → 1 LP after lock)
        uint256 tinyA = 1001;
        uint256 tinyB = 1001;
        uint256 attackerLP = _addLiquidity(attacker, tinyA, tinyB);

        assertEq(attackerLP, 1, "Attacker should get only 1 LP after MINIMUM_LIQUIDITY lock");

        // Attacker donates huge amounts to try to inflate share price
        vm.prank(attacker);
        tokenA.transfer(address(pool), 1_000_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 1_000_000e18);

        // Bob deposits a reasonable amount
        // Since reserves are NOT auto-synced, Bob's LP is calculated based on
        // the original reserves (1001 each), so Bob gets a fair amount of LP
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Bob should get LP tokens — the attack doesn't give Bob 0 LP
        assertGt(bobLP, 0, "Bob should receive LP tokens");

        // The attacker's donated tokens are NOT captured in reserves (no sync called),
        // so the attacker can't withdraw them via removeLiquidity either.
        // The attacker only gets back proportional to reserves for their 1 LP.
        (uint256 attackerWithdrawA, uint256 attackerWithdrawB) = _removeLiquidity(attacker, 1);
        // Attacker gets back very little compared to their donation — attack is unprofitable
        assertLt(attackerWithdrawA, tinyA + 1, "Attacker should get back approximately their deposit");
    }

    // ═══════════════════════════════════════════
    // DONATION ATTACK VIA DIRECT TRANSFER
    // ═══════════════════════════════════════════

    /// @dev Direct token transfers to the pool do NOT affect LP token pricing
    ///      because reserves are tracked internally, not via balanceOf.
    function test_directTransfer_doesNotAffectLpPricing() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Attacker donates tokens directly to the pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Reserves should NOT have changed — donations aren't tracked
        assertEq(pool.reserveA(), DEPOSIT_A, "reserveA should not change from direct transfer");
        assertEq(pool.reserveB(), DEPOSIT_B, "reserveB should not change from direct transfer");

        // Bob deposits and gets LP based on reserves (not inflated balances)
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Bob should get approximately the same LP as Alice (minus MINIMUM_LIQUIDITY effect)
        // because reserves are based on actual deposits, not donations
        uint256 aliceLPAmount = aliceLP;
        assertApproxEqAbs(bobLP, aliceLPAmount, pool.MINIMUM_LIQUIDITY(), "Bob should get similar LP to Alice");
    }

    /// @dev Direct transfers don't affect removeLiquidity either
    function test_directTransfer_doesNotAffectWithdrawal() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Donation to pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Alice's withdrawal is based on reserves, not balances
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice should get approximately her original deposit
        // NOT the inflated amount that includes the donation
        assertApproxEqAbs(amountA, DEPOSIT_A, 1e15, "Withdrawal should be based on reserves, not balances");
        assertApproxEqAbs(amountB, DEPOSIT_B, 1e15, "Withdrawal should be based on reserves, not balances");
    }

    // ═══════════════════════════════════════════
    // SYNC FUNCTION
    // ═══════════════════════════════════════════

    function test_sync_updatesReservesToActualBalances() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Donate tokens directly
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Before sync: reserves don't include donation
        assertEq(pool.reserveA(), DEPOSIT_A);
        assertEq(pool.reserveB(), DEPOSIT_B);

        // Call sync
        pool.sync();

        // After sync: reserves should match actual balances
        assertEq(pool.reserveA(), tokenA.balanceOf(address(pool)));
        assertEq(pool.reserveB(), tokenB.balanceOf(address(pool)));
        assertEq(pool.reserveA(), DEPOSIT_A + 50_000e18);
        assertEq(pool.reserveB(), DEPOSIT_B + 50_000e18);
    }

    function test_sync_emitsSyncEvent() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        vm.expectEmit(false, false, false, true);
        emit Sync(DEPOSIT_A + 50_000e18, DEPOSIT_B + 50_000e18);
        pool.sync();
    }

    // ═══════════════════════════════════════════
    // SYNC RECOVERY
    // ═══════════════════════════════════════════

    /// @dev After a donation attack, sync() recovers the donated tokens
    ///      by making them part of the pool's reserves, shared proportionally
    ///      among all LP holders.
    function test_sync_recovery_makesDonationsShared() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Attacker donates tokens
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Before sync: Alice's withdrawal is based on pre-donation reserves
        // The donation is "stuck" — not accounted for in reserves

        // Call sync to capture donation into reserves
        pool.sync();

        // Now Alice's withdrawal should reflect the donation
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice should get more than her original deposit (includes share of donation)
        assertGt(amountA, DEPOSIT_A, "After sync, Alice should benefit from donation");
        assertGt(amountB, DEPOSIT_B, "After sync, Alice should benefit from donation");
    }

    /// @dev sync() can be called multiple times idempotently
    function test_sync_idempotent() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        pool.sync();
        assertEq(pool.reserveA(), DEPOSIT_A);
        assertEq(pool.reserveB(), DEPOSIT_B);

        pool.sync();
        assertEq(pool.reserveA(), DEPOSIT_A);
        assertEq(pool.reserveB(), DEPOSIT_B);
    }

    // ═══════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════

    function test_partialWithdrawal() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        uint256 halfLP = aliceLP / 2;
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, halfLP);

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(pool.balanceOf(alice), aliceLP - halfLP, "Alice should have half LP remaining");
    }

    function test_threeDepositors_withdrawInOrder() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);
        uint256 carolLP = _addLiquidity(carol, DEPOSIT_A, DEPOSIT_B);

        _removeLiquidity(alice, aliceLP);
        _removeLiquidity(bob, bobLP);
        _removeLiquidity(carol, carolLP);

        // MINIMUM_LIQUIDITY tokens still locked at address(0), so some dust remains
        assertGt(pool.reserveA(), 0, "Some reserveA dust should remain from MINIMUM_LIQUIDITY");
        assertGt(pool.reserveB(), 0, "Some reserveB dust should remain from MINIMUM_LIQUIDITY");
    }

    function test_multipleDepositors_cumulativeValue() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Total LP should equal aliceLP + bobLP + MINIMUM_LIQUIDITY
        assertEq(pool.totalSupply(), aliceLP + bobLP + pool.MINIMUM_LIQUIDITY(), "Total supply mismatch");
    }

    function test_minimumLiquidity_cannotBeWithdrawn() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        // MINIMUM_LIQUIDITY is locked at address(0) — nobody can access it
        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY());
    }

    function test_minimumLiquidity_value() public {
        assertEq(pool.MINIMUM_LIQUIDITY(), 1000);
    }

    // ═══════════════════════════════════════════
    // HELPER
    // ═══════════════════════════════════════════

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

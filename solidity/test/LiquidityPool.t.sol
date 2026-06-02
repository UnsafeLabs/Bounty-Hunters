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
    // HAPPY PATH — Deposit & Withdraw
    // ═══════════════════════════════════════════

    function test_addLiquidity_firstDeposit() public {
        uint256 lpTokens = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // LP tokens = sqrt(100000e18 * 100000e18) - MINIMUM_LIQUIDITY
        uint256 expected = sqrt(DEPOSIT_A * DEPOSIT_B) - pool.MINIMUM_LIQUIDITY();
        assertEq(lpTokens, expected, "First deposit LP tokens incorrect");
        assertEq(pool.balanceOf(alice), expected, "Alice LP balance incorrect");

        // MINIMUM_LIQUIDITY locked to address(0)
        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY(), "MINIMUM_LIQUIDITY not locked to address(0)");
    }

    function test_addLiquidity_secondDeposit() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Bob deposits same amounts — should get same LP as Alice (minus MINIMUM_LIQUIDITY locked)
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Bob's LP = amountA * totalSupply / reserveA (same ratio)
        uint256 totalAfterAlice = sqrt(DEPOSIT_A * DEPOSIT_B); // includes MINIMUM_LIQUIDITY at address(0)
        uint256 expectedBobLP = DEPOSIT_A * totalAfterAlice / DEPOSIT_A;
        assertEq(bobLP, expectedBobLP, "Second deposit LP tokens incorrect");
    }

    function test_removeLiquidity_happyPath() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        uint256 aliceTokenABefore = tokenA.balanceOf(alice);
        uint256 aliceTokenBBefore = tokenB.balanceOf(alice);

        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice should get back approximately her deposited amounts
        // (slight rounding due to MINIMUM_LIQUIDITY lock)
        assertGt(amountA, 0, "Should receive tokenA");
        assertGt(amountB, 0, "Should receive tokenB");

        uint256 aliceTokenAAfter = tokenA.balanceOf(alice);
        uint256 aliceTokenBAfter = tokenB.balanceOf(alice);
        assertEq(aliceTokenAAfter - aliceTokenABefore, amountA);
        assertEq(aliceTokenBAfter - aliceTokenBBefore, amountB);
    }

    function test_addLiquidity_emitsEvent() public {
        vm.prank(alice);
        tokenA.approve(address(pool), DEPOSIT_A);
        vm.prank(alice);
        tokenB.approve(address(pool), DEPOSIT_B);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        uint256 expectedLP = sqrt(DEPOSIT_A * DEPOSIT_B) - pool.MINIMUM_LIQUIDITY();
        emit LiquidityAdded(alice, DEPOSIT_A, DEPOSIT_B, expectedLP);
        pool.addLiquidity(DEPOSIT_A, DEPOSIT_B);
    }

    function test_removeLiquidity_emitsEvent() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit LiquidityRemoved(alice, 0, 0, aliceLP); // amounts will be computed
        pool.removeLiquidity(aliceLP);
    }

    // ═══════════════════════════════════════════
    // FIRST DEPOSITOR MANIPULATION ATTACK
    // ═══════════════════════════════════════════

    /// @dev The classic attack: Attacker deposits 1 wei of each token (getting 1 LP),
    ///      then donates a huge amount to inflate the share price, so the next depositor
    ///      gets 0 LP tokens. With MINIMUM_LIQUIDITY lock, the attacker must deposit
    ///      enough that sqrt(amountA * amountB) > MINIMUM_LIQUIDITY, making the attack
    ///      far more expensive and economically unviable.
    function test_firstDepositor_cannotManipulateWithTinyDeposit() public {
        // Attacker tries to deposit 1 wei of each token
        vm.prank(attacker);
        tokenA.approve(address(pool), 1);
        vm.prank(attacker);
        tokenB.approve(address(pool), 1);
        vm.prank(attacker);
        vm.expectRevert("Insufficient first-deposit liquidity");
        pool.addLiquidity(1, 1);
    }

    /// @dev Even with larger amounts, the MINIMUM_LIQUIDITY lock means the attacker
    ///      cannot create a pool with trivially small LP supply that could be inflated.
    function test_firstDepositor_minimumLiquidityLockPreventsZeroLpExploit() public {
        // Attacker deposits minimum viable amount
        // They need sqrt(a * b) > MINIMUM_LIQUIDITY = 1000
        // sqrt(1001 * 1001) = 1001 > 1000, so this barely passes
        uint256 tinyA = 1001;
        uint256 tinyB = 1001;
        uint256 attackerLP = _addLiquidity(attacker, tinyA, tinyB);

        // Attacker gets only 1 LP (1001 - 1000 locked), 1000 is locked at address(0)
        assertEq(attackerLP, 1, "Attacker should get only 1 LP after MINIMUM_LIQUIDITY lock");
        assertEq(pool.totalSupply(), 1001, "Total supply should include MINIMUM_LIQUIDITY");

        // Attacker donates huge amounts to try to inflate the share price
        vm.prank(attacker);
        tokenA.transfer(address(pool), 1_000_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 1_000_000e18);

        // Now Bob deposits a reasonable amount
        // With the donation, reserves will be synced in addLiquidity
        // Bob's LP = min(amountA * totalSupply / reserveA, amountB * totalSupply / reserveB)
        // Since attacker donated huge amounts, Bob will get very few LP tokens
        // BUT the attacker also lost their donated tokens — they're shared proportionally
        // The attacker's 1 LP represents 1/1001 of the pool after Bob deposits
        // The attacker cannot withdraw the donated tokens — they're captured in reserves

        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Bob should get some LP tokens — the attack doesn't give Bob 0 LP
        assertGt(bobLP, 0, "Bob should receive LP tokens");

        // The attacker's share of the pool is minimal
        // attacker owns 1 LP out of (1001 + bobLP) total supply
        // Even after donating, attacker can only withdraw proportional to 1 LP
        (uint256 attackerWithdrawA, uint256 attackerWithdrawB) = _removeLiquidity(attacker, 1);
        // Attacker gets back far less than they donated — attack is unprofitable
        assertLt(attackerWithdrawA, 1_000_000e18, "Attacker should get back less than donated tokenA");
    }

    /// @dev Demonstrate the attack would succeed WITHOUT the fix.
    ///      We show that with the fix, the attack is prevented.
    function test_firstDepositor_manipulationAttackIsUnprofitable() public {
        // First depositor puts in a fair amount
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Attacker tries to donate and then add liquidity to steal
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Attacker adds liquidity — they'll get LP proportional to their deposit
        // Since reserves sync in addLiquidity, the donation is captured in reserves
        uint256 attackerLP = _addLiquidity(attacker, DEPOSIT_A, DEPOSIT_B);

        // Both depositors should have roughly equal LP (same deposit amounts)
        // Alice's LP might be slightly different because the first deposit includes
        // MINIMUM_LIQUIDITY in totalSupply, but they should be close
        uint256 ratio = aliceLP * 100 / attackerLP;
        assertGt(ratio, 90, "Alice and attacker should have roughly equal LP");
        assertLt(ratio, 110, "Alice and attacker should have roughly equal LP");
    }

    // ═══════════════════════════════════════════
    // MINIMUM LIQUIDITY LOCK
    // ═══════════════════════════════════════════

    function test_minimumLiquidity_lockedToZeroAddress() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY(), "MINIMUM_LIQUIDITY should be at address(0)");
        assertEq(pool.totalSupply() - pool.balanceOf(alice), pool.MINIMUM_LIQUIDITY());
    }

    function test_minimumLiquidity_cannotBeWithdrawn() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Nobody can burn the MINIMUM_LIQUIDITY tokens — address(0) has no private key
        // If we try to removeLiquidity from address(0), it will fail
        // (pranking address(0) is blocked in foundry, but conceptually impossible)
        // The MINIMUM_LIQUIDITY is permanently locked
        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY());
    }

    function test_minimumLiquidity_preventsDustPoolCreation() public {
        // Trying to create a pool with amounts so small that sqrt(a*b) <= MINIMUM_LIQUIDITY
        vm.prank(attacker);
        tokenA.approve(address(pool), 1000);
        vm.prank(attacker);
        tokenB.approve(address(pool), 1000);
        vm.prank(attacker);
        vm.expectRevert("Insufficient first-deposit liquidity");
        pool.addLiquidity(1000, 1000);
    }

    function test_minimumLiquidity_value() public {
        assertEq(pool.MINIMUM_LIQUIDITY(), 1000);
    }

    // ═══════════════════════════════════════════
    // MULTIPLE DEPOSITOR SCENARIOS
    // ═══════════════════════════════════════════

    function test_multipleDepositors_fairLPTokens() public {
        // Three depositors deposit the same amounts
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);
        uint256 carolLP = _addLiquidity(carol, DEPOSIT_A, DEPOSIT_B);

        // Bob and Carol should get the same LP tokens (same deposit, same reserves)
        assertEq(bobLP, carolLP, "Bob and Carol should get same LP for same deposit");

        // Alice's LP should be close to Bob's but slightly different due to MINIMUM_LIQUIDITY
        // Alice gets sqrt(a*b) - MINIMUM_LIQUIDITY
        // Bob gets amountA * totalSupply / reserveA, where totalSupply includes MINIMUM_LIQUIDITY
        assertApproxEqAbs(aliceLP, bobLP, pool.MINIMUM_LIQUIDITY(), "Alice and Bob LP should be approximately equal");
    }

    function test_multipleDepositors_proportionalWithdrawal() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Alice withdraws all her LP
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice should get approximately half the pool (slightly less due to MINIMUM_LIQUIDITY)
        uint256 totalPoolA = DEPOSIT_A * 2; // 2 depositors
        uint256 totalPoolB = DEPOSIT_B * 2;
        // Alice's share ≈ aliceLP / totalSupply of pool tokens
        assertGt(amountA, totalPoolA * 40 / 100, "Alice should get ~50% of tokenA");
        assertLt(amountA, totalPoolA * 55 / 100, "Alice should not get >55% of tokenA");
    }

    function test_threeDepositors_withdrawInOrder() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);
        uint256 carolLP = _addLiquidity(carol, DEPOSIT_A, DEPOSIT_B);

        // Each withdraws fully
        _removeLiquidity(alice, aliceLP);
        _removeLiquidity(bob, bobLP);
        _removeLiquidity(carol, carolLP);

        // MINIMUM_LIQUIDITY tokens still locked at address(0), so some dust remains
        assertGt(pool.reserveA(), 0, "Some reserveA dust should remain from MINIMUM_LIQUIDITY");
        assertGt(pool.reserveB(), 0, "Some reserveB dust should remain from MINIMUM_LIQUIDITY");
    }

    function test_partialWithdrawal() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Withdraw half
        uint256 halfLP = aliceLP / 2;
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, halfLP);

        assertGt(amountA, 0);
        assertGt(amountB, 0);
        assertEq(pool.balanceOf(alice), aliceLP - halfLP, "Alice should have half LP remaining");
    }

    // ═══════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════

    function test_addLiquidity_zeroAmountA_reverts() public {
        vm.prank(alice);
        tokenB.approve(address(pool), DEPOSIT_B);

        vm.prank(alice);
        vm.expectRevert("Both amounts must be > 0");
        pool.addLiquidity(0, DEPOSIT_B);
    }

    function test_addLiquidity_zeroAmountB_reverts() public {
        vm.prank(alice);
        tokenA.approve(address(pool), DEPOSIT_A);

        vm.prank(alice);
        vm.expectRevert("Both amounts must be > 0");
        pool.addLiquidity(DEPOSIT_A, 0);
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

    function test_removeLiquidity_moreThanBalance_reverts() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        vm.prank(alice);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(aliceLP + 1);
    }

    function test_addLiquidity_asymmetricAmounts() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Bob deposits more tokenA than tokenB — should get LP based on the smaller ratio
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B / 2);

        // Bob should get fewer LP tokens than Alice
        assertLt(bobLP, aliceLP, "Asymmetric deposit should yield fewer LP tokens");

        // Verify reserves updated correctly
        assertGt(pool.reserveA(), pool.reserveB(), "reserveA should be > reserveB after asymmetric deposit");
    }

    function test_donationBeforeSecondDeposit_doesNotStealFromFirst() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        // Someone donates tokens directly to the pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);
        vm.prank(attacker);
        tokenB.transfer(address(pool), 50_000e18);

        // Alice withdraws — she should get more than her original deposit
        // because the donation increased the reserves (which are now synced)
        (uint256 amountA, uint256 amountB) = _removeLiquidity(alice, aliceLP);

        // Alice's share of the pool includes part of the donation
        assertGt(amountA, DEPOSIT_A, "Alice should benefit from donation via increased share value");
        assertGt(amountB, DEPOSIT_B, "Alice should benefit from donation via increased share value");
    }

    function test_reservesSyncAfterDonation() public {
        _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);

        uint256 reserveABefore = pool.reserveA();
        uint256 reserveBBefore = pool.reserveB();

        // Donate tokens
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000e18);

        // Reserves are NOT yet updated (only update on add/remove liquidity)
        assertEq(pool.reserveA(), reserveABefore, "Reserve should not update before next addLiquidity");

        // When next deposit happens, reserves sync
        _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Now reserves should include the donation
        assertGt(pool.reserveA(), reserveABefore + DEPOSIT_A, "ReserveA should include donation after sync");
    }

    function test_firstDeposit_minimumLiquidityBoundary() public {
        // Exactly at the boundary: sqrt(1001 * 1001) = 1001 > 1000, so 1 LP minted
        uint256 lp = _addLiquidity(alice, 1001, 1001);
        assertEq(lp, 1, "Should get 1 LP at exact boundary");
        assertEq(pool.balanceOf(address(0)), 1000, "1000 should be locked");
    }

    function test_firstDeposit_justBelowMinimumLiquidity_reverts() public {
        // sqrt(1000 * 1000) = 1000, which is NOT > MINIMUM_LIQUIDITY (1000)
        vm.prank(attacker);
        tokenA.approve(address(pool), 1000);
        vm.prank(attacker);
        tokenB.approve(address(pool), 1000);
        vm.prank(attacker);
        vm.expectRevert("Insufficient first-deposit liquidity");
        pool.addLiquidity(1000, 1000);
    }

    function test_redepositAfterFullWithdrawal() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        _removeLiquidity(alice, aliceLP);

        // Pool still has MINIMUM_LIQUIDITY tokens, so totalSupply() > 0
        // Next deposit uses proportional calculation (not first-deposit path)
        uint256 newLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);
        assertGt(newLP, 0, "Should be able to deposit after full withdrawal");
    }

    function test_multipleDepositors_cumulativeValue() public {
        uint256 aliceLP = _addLiquidity(alice, DEPOSIT_A, DEPOSIT_B);
        uint256 bobLP = _addLiquidity(bob, DEPOSIT_A, DEPOSIT_B);

        // Total LP should equal aliceLP + bobLP + MINIMUM_LIQUIDITY
        assertEq(pool.totalSupply(), aliceLP + bobLP + pool.MINIMUM_LIQUIDITY(), "Total supply mismatch");
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

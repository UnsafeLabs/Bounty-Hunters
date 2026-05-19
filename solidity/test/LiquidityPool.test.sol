// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 10_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public attacker = address(0xBAD);

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Distribute tokens
        tokenA.transfer(alice, 1_000_000 ether);
        tokenB.transfer(alice, 1_000_000 ether);
        tokenA.transfer(bob, 500_000 ether);
        tokenB.transfer(bob, 500_000 ether);
        tokenA.transfer(attacker, 1_000_000 ether);
        tokenB.transfer(attacker, 1_000_000 ether);
    }

    // ─── First deposit minimum liquidity lock ──────────────────────────

    function test_firstDeposit_locksMinimumLiquidity() public {
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);

        uint256 lpReceived = pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        // sqrt(10000e18 * 10000e18) = 10000e18
        // LP minted to alice = 10000e18 - 1000 (MINIMUM_LIQUIDITY)
        uint256 expectedTotal = 10_000 ether;
        assertEq(lpReceived, expectedTotal - pool.MINIMUM_LIQUIDITY());

        // MINIMUM_LIQUIDITY locked at dead address
        assertEq(pool.balanceOf(address(0xdead)), pool.MINIMUM_LIQUIDITY());

        // Total supply = sqrt + minimum locked
        assertEq(pool.totalSupply(), expectedTotal);
    }

    function test_revert_firstDeposit_tooSmall() public {
        // Very small first deposit should fail (sqrt < MINIMUM_LIQUIDITY)
        vm.startPrank(alice);
        tokenA.approve(address(pool), 100);
        tokenB.approve(address(pool), 100);

        vm.expectRevert("Initial liquidity too low");
        pool.addLiquidity(100, 100);
        vm.stopPrank();
    }

    // ─── First-depositor price manipulation attack ─────────────────────

    function test_firstDepositorAttack_mitigated() public {
        // ATTACK SCENARIO:
        // 1. Attacker deposits 1 wei each → gets tiny LP
        // 2. Attacker donates 100 ether to pool directly → inflates LP price
        // 3. Next depositor gets 0 LP tokens due to rounding
        //
        // WITH FIX: Step 1 fails because sqrt(1*1) = 1 < MINIMUM_LIQUIDITY

        vm.startPrank(attacker);
        tokenA.approve(address(pool), 1);
        tokenB.approve(address(pool), 1);

        // Step 1 fails — initial liquidity too low
        vm.expectRevert("Initial liquidity too low");
        pool.addLiquidity(1, 1);
        vm.stopPrank();
    }

    // ─── removeLiquidity uses internal reserves ────────────────────────

    function test_removeLiquidity_usesInternalReserves() public {
        // Setup: Alice adds liquidity
        vm.startPrank(alice);
        tokenA.approve(address(pool), 10_000 ether);
        tokenB.approve(address(pool), 10_000 ether);
        uint256 lpTokens = pool.addLiquidity(10_000 ether, 10_000 ether);
        vm.stopPrank();

        // Record reserves before donation
        (uint256 rA_before, uint256 rB_before) = pool.getReserves();
        assertEq(rA_before, 10_000 ether);
        assertEq(rB_before, 10_000 ether);

        // Attacker donates tokens directly to the pool (bypassing addLiquidity)
        vm.startPrank(attacker);
        tokenA.transfer(address(pool), 5_000 ether);
        tokenB.transfer(address(pool), 5_000 ether);
        vm.stopPrank();

        // Internal reserves should NOT change
        (uint256 rA_after, uint256 rB_after) = pool.getReserves();
        assertEq(rA_after, 10_000 ether, "Internal reserve A unchanged");
        assertEq(rB_after, 10_000 ether, "Internal reserve B unchanged");

        // Alice removes all liquidity — gets back proportional to INTERNAL reserves
        vm.startPrank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpTokens);
        vm.stopPrank();

        // Alice gets back based on internal reserves, NOT inflated balanceOf
        // She should get ~10000 ether (minus rounding from locked liquidity)
        assertLt(outA, 10_001 ether, "Should not get donated tokens");
        assertLt(outB, 10_001 ether, "Should not get donated tokens");
    }

    // ─── Donation attack prevention ────────────────────────────────────

    function test_directTransfer_doesNotAffectLPPricing() public {
        // Alice adds initial liquidity
        vm.startPrank(alice);
        tokenA.approve(address(pool), 50_000 ether);
        tokenB.approve(address(pool), 50_000 ether);
        pool.addLiquidity(50_000 ether, 50_000 ether);
        vm.stopPrank();

        // Attacker donates a huge amount directly
        vm.startPrank(attacker);
        tokenA.transfer(address(pool), 500_000 ether);
        vm.stopPrank();

        // Bob should still be able to add liquidity at fair price
        vm.startPrank(bob);
        tokenA.approve(address(pool), 50_000 ether);
        tokenB.approve(address(pool), 50_000 ether);
        uint256 bobLP = pool.addLiquidity(50_000 ether, 50_000 ether);
        vm.stopPrank();

        // Bob should get roughly equal LP to Alice (proportional)
        assertTrue(bobLP > 0, "Bob should receive LP tokens");
    }

    // ─── Sync recovery ─────────────────────────────────────────────────

    function test_sync_updatesReserves() public {
        // Alice adds liquidity
        vm.startPrank(alice);
        tokenA.approve(address(pool), 10_000 ether);
        tokenB.approve(address(pool), 10_000 ether);
        pool.addLiquidity(10_000 ether, 10_000 ether);
        vm.stopPrank();

        // Someone accidentally sends tokens directly
        vm.prank(attacker);
        tokenA.transfer(address(pool), 5_000 ether);

        // Before sync: internal reserve != actual balance
        (uint256 rA,) = pool.getReserves();
        assertEq(rA, 10_000 ether, "Internal reserve unchanged before sync");

        uint256 actualBalA = tokenA.balanceOf(address(pool));
        assertEq(actualBalA, 15_000 ether, "Actual balance includes donation");

        // Call sync to reconcile
        pool.sync();

        // After sync: internal reserves match actual balances
        (uint256 rA_synced, uint256 rB_synced) = pool.getReserves();
        assertEq(rA_synced, 15_000 ether, "Reserve A synced");
        assertEq(rB_synced, 10_000 ether, "Reserve B unchanged");
    }

    // ─── Subsequent deposits proportional ──────────────────────────────

    function test_subsequentDeposit_proportional() public {
        // Alice: first deposit
        vm.startPrank(alice);
        tokenA.approve(address(pool), 100_000 ether);
        tokenB.approve(address(pool), 100_000 ether);
        pool.addLiquidity(100_000 ether, 100_000 ether);
        vm.stopPrank();

        uint256 totalBefore = pool.totalSupply();

        // Bob: second deposit (same ratio)
        vm.startPrank(bob);
        tokenA.approve(address(pool), 50_000 ether);
        tokenB.approve(address(pool), 50_000 ether);
        uint256 bobLP = pool.addLiquidity(50_000 ether, 50_000 ether);
        vm.stopPrank();

        // Bob should get ~50% of previous total supply (proportional)
        uint256 expectedLP = 50_000 ether * totalBefore / 100_000 ether;
        assertEq(bobLP, expectedLP, "Proportional LP minting");
    }

    // ─── Edge cases ────────────────────────────────────────────────────

    function test_revert_addLiquidity_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Amounts must be > 0");
        pool.addLiquidity(0, 1000);
    }

    function test_revert_removeLiquidity_zeroTokens() public {
        vm.prank(alice);
        vm.expectRevert("Must burn > 0");
        pool.removeLiquidity(0);
    }
}

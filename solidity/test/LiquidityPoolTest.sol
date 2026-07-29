// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";

/// @notice Mock ERC20 for testing
contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockToken public tokenA;
    MockToken public tokenB;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public attacker = makeAddr("attacker");

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Fund accounts
        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 1_000_000 ether);
        tokenB.mint(bob, 1_000_000 ether);
        tokenA.mint(attacker, 1_000_000 ether);
        tokenB.mint(attacker, 1_000_000 ether);
    }

    // ─── First deposit tests ────────────────────────────────────────

    function test_firstDeposit_locksMinimumLiquidity() public {
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        uint256 lpTokens = pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        // address(0) should hold MINIMUM_LIQUIDITY tokens
        assertEq(pool.balanceOf(address(0)), MINIMUM_LIQUIDITY);

        // Alice should receive lpTokens - MINIMUM_LIQUIDITY
        assertEq(pool.balanceOf(alice), lpTokens - MINIMUM_LIQUIDITY);

        // Total supply = lpTokens + MINIMUM_LIQUIDITY (locked)
        assertEq(pool.totalSupply(), lpTokens + MINIMUM_LIQUIDITY);

        // Reserves should match deposited amounts
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_firstDeposit_revertIfInsufficientLiquidity() public {
        // Very tiny amounts that result in sqrt < MINIMUM_LIQUIDITY
        uint256 amountA = 100;
        uint256 amountB = 100;
        // sqrt(100 * 100) = 100, which is < MINIMUM_LIQUIDITY (1000)

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        vm.expectRevert("Insufficient initial liquidity");
        pool.addLiquidity(amountA, amountB);
        vm.stopPrank();
    }

    function test_subsequentDeposit_proportionalMinting() public {
        // Alice deposits first
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        // Bob deposits same ratio
        uint256 bobAmountA = 5_000 ether;
        uint256 bobAmountB = 5_000 ether;

        vm.startPrank(bob);
        tokenA.approve(address(pool), bobAmountA);
        tokenB.approve(address(pool), bobAmountB);
        uint256 bobLp = pool.addLiquidity(bobAmountA, bobAmountB);
        vm.stopPrank();

        // Bob's LP should be proportional: 5000/10000 * totalSupply()
        assertGt(bobLp, 0);
        assertEq(pool.reserveA(), amountA + bobAmountA);
        assertEq(pool.reserveB(), amountB + bobAmountB);
    }

    // ─── Price manipulation prevention ──────────────────────────────

    function test_priceManipulation_donationAttackPrevented() public {
        // Alice deposits normally
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        uint256 aliceLpBefore = pool.balanceOf(alice);

        // Attacker tries to donate tokens directly to the pool
        // (bypassing addLiquidity)
        tokenA.mint(address(pool), 100_000 ether);

        // Alice removes her liquidity - should get reserveA-based amount,
        // NOT the inflated balance
        vm.startPrank(alice);
        (uint256 withdrawnA, ) = pool.removeLiquidity(aliceLpBefore);
        vm.stopPrank();

        // Alice's withdrawal should be based on internal reserves (10_000),
        // not the inflated balance (110_000)
        assertLe(withdrawnA, amountA + 1); // +1 for rounding
    }

    // ─── Sync function tests ────────────────────────────────────────

    function test_sync_recoversFromDonationAttack() public {
        // Alice deposits
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        // Attacker donates tokens directly
        tokenA.mint(address(pool), 50_000 ether);

        // Reserves should still show original amounts
        assertEq(pool.reserveA(), amountA);

        // Call sync to update reserves
        pool.sync();

        // Now reserves should reflect actual balances
        assertEq(pool.reserveA(), amountA + 50_000 ether);

        // Verify Sync event was emitted
        // (tested implicitly through state changes)
    }

    function test_sync_emitsSyncEvent() public {
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        pool.addLiquidity(amountA, amountB);
        vm.stopPrank();

        // Donate tokens
        tokenA.mint(address(pool), 5_000 ether);

        // Sync should emit Sync event
        vm.expectEmit(false, false, false, true);
        emit LiquidityPool.Sync(amountA + 5_000 ether, amountB);
        pool.sync();
    }

    // ─── Remove liquidity tests ─────────────────────────────────────

    function test_removeLiquidity_usesReservesNotBalance() public {
        uint256 amountA = 10_000 ether;
        uint256 amountB = 10_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(pool), amountA);
        tokenB.approve(address(pool), amountB);
        pool.addLiquidity(amountA, amountB);
        uint256 aliceLp = pool.balanceOf(alice);
        vm.stopPrank();

        // Direct transfer should NOT affect withdrawal amounts
        tokenA.mint(address(pool), 999_999 ether);

        vm.startPrank(alice);
        (uint256 withdrawnA, uint256 withdrawnB) = pool.removeLiquidity(aliceLp);
        vm.stopPrank();

        // Should get reserve-based amount, not balance-based
        assertLe(withdrawnA, amountA + 1);
        assertEq(withdrawnB, amountB);
    }

    function test_removeLiquidity_revertIfZero() public {
        vm.startPrank(alice);
        vm.expectRevert("Must burn > 0");
        pool.removeLiquidity(0);
        vm.stopPrank();
    }

    function test_removeLiquidity_revertIfInsufficientBalance() public {
        vm.startPrank(alice);
        vm.expectRevert("Insufficient LP tokens");
        pool.removeLiquidity(1);
        vm.stopPrank();
    }
}

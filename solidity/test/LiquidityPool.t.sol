// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/LiquidityPool.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool pool;
    MockERC20 tokenA;
    MockERC20 tokenB;

    address user1 = address(0x1111);
    address user2 = address(0x2222);
    address attacker = address(0xBEEF);

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event Sync(uint256 reserveA, uint256 reserveB);

    function setUp() public {
        tokenA = new MockERC20();
        tokenB = new MockERC20();
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        address[3] memory who = [user1, user2, attacker];
        for (uint256 i = 0; i < who.length; i++) {
            tokenA.mint(who[i], 10_000_000);
            tokenB.mint(who[i], 10_000_000);
            vm.startPrank(who[i]);
            tokenA.approve(address(pool), type(uint256).max);
            tokenB.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    // First deposit locks MINIMUM_LIQUIDITY at the dead address and the
    // depositor receives sqrt(amountA * amountB) - MINIMUM_LIQUIDITY.
    function testFirstDepositLock() public {
        vm.prank(user1);
        uint256 lp = pool.addLiquidity(100_000, 100_000);

        uint256 expectedTotal = 100_000; // sqrt(100_000 * 100_000)
        assertEq(pool.balanceOf(DEAD), pool.MINIMUM_LIQUIDITY());
        assertEq(lp, expectedTotal - pool.MINIMUM_LIQUIDITY());
        assertEq(pool.balanceOf(user1), expectedTotal - pool.MINIMUM_LIQUIDITY());
        assertEq(pool.totalSupply(), expectedTotal);
    }

    // The classic first-depositor attack (deposit dust, then inflate) is
    // impossible: a sub-minimum first deposit reverts, and a donation after a
    // real deposit does not change the LP shares a later depositor receives.
    function testPriceManipulationAttempt() public {
        // Dust first deposit can no longer bootstrap the pool.
        vm.prank(attacker);
        vm.expectRevert("Insufficient liquidity");
        pool.addLiquidity(1, 1);

        // Legitimate first deposit.
        vm.prank(user1);
        pool.addLiquidity(100_000, 100_000);

        // Attacker donates directly to skew balances.
        vm.prank(attacker);
        tokenA.transfer(address(pool), 5_000_000);

        // Second depositor's shares are computed from reserves, not balances,
        // so the donation does not let the attacker steal value.
        vm.prank(user2);
        uint256 lp2 = pool.addLiquidity(100_000, 100_000);
        assertEq(lp2, 100_000); // 100_000 * totalSupply / reserveA
    }

    // Tokens transferred directly to the pool do not inflate withdrawals,
    // because removeLiquidity uses internal reserves instead of balanceOf.
    function testDonationAttackViaTransfer() public {
        vm.prank(user1);
        uint256 lp = pool.addLiquidity(100_000, 100_000);

        // Donate a large amount directly to the pool.
        vm.prank(attacker);
        tokenA.transfer(address(pool), 1_000_000);

        // user1 withdraws everything they hold.
        vm.prank(user1);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp);

        // Withdrawal is proportional to reserves (99_000), not the inflated
        // balance, so the donation is not extractable.
        assertEq(outA, 99_000);
        assertEq(outB, 99_000);
    }

    // sync() pulls reserves up to actual balances and emits Sync.
    function testSyncRecovery() public {
        vm.prank(user1);
        pool.addLiquidity(100_000, 100_000);

        vm.prank(attacker);
        tokenA.transfer(address(pool), 50_000);

        assertEq(pool.reserveA(), 100_000); // stale before sync

        vm.expectEmit(false, false, false, true);
        emit Sync(150_000, 100_000);
        pool.sync();

        assertEq(pool.reserveA(), 150_000);
        assertEq(pool.reserveB(), 100_000);
    }

    // Subsequent deposits mint proportional LP tokens.
    function testSubsequentDeposits() public {
        vm.prank(user1);
        pool.addLiquidity(100_000, 100_000);

        vm.prank(user2);
        uint256 lp2 = pool.addLiquidity(50_000, 50_000);

        // 50_000 * totalSupply(100_000) / reserveA(100_000) = 50_000
        assertEq(lp2, 50_000);
        assertEq(pool.reserveA(), 150_000);
        assertEq(pool.reserveB(), 150_000);
    }

    // Normal removeLiquidity returns reserves proportionally and updates them.
    function testRemoveLiquidity() public {
        vm.prank(user1);
        uint256 lp = pool.addLiquidity(100_000, 100_000);

        vm.prank(user1);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp);

        assertEq(outA, 99_000);
        assertEq(outB, 99_000);
        // The 1_000 locked shares keep 1_000 of each reserve in the pool.
        assertEq(pool.reserveA(), 1_000);
        assertEq(pool.reserveB(), 1_000);
        assertEq(pool.balanceOf(user1), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock ERC20 Token
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
    address public user1 = address(0x1);
    address public user2 = address(0x2);
    address public attacker = address(0x3);

    function setUp() public {
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        // Mint tokens to users
        tokenA.mint(user1, 1000000e18);
        tokenB.mint(user1, 1000000e18);
        tokenA.mint(user2, 1000000e18);
        tokenB.mint(user2, 1000000e18);
        tokenA.mint(attacker, 1000000e18);
        tokenB.mint(attacker, 1000000e18);

        // Approvals
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

    function testFirstDepositLocksMinimumLiquidity() public {
        // First deposit
        vm.prank(user1);
        pool.addLiquidity(10000e18, 10000e18);

        // Check that MINIMUM_LIQUIDITY is locked at address(0)
        uint256 lockedBalance = pool.balanceOf(address(0));
        assertEq(lockedBalance, 1000);

        // User1 should have less than sqrt(10000 * 10000)
        uint256 user1Balance = pool.balanceOf(user1);
        assertLt(user1Balance, 10000e18);
        assertEq(user1Balance, 10000e18 - 1000);
    }

    function testPriceManipulationPrevented() public {
        // Attacker tries to manipulate by being first depositor with tiny amount
        vm.prank(attacker);
        pool.addLiquidity(1e18, 1e18);

        // Attacker gets LP tokens minus MINIMUM_LIQUIDITY
        uint256 attackerLP = pool.balanceOf(attacker);
        assertEq(attackerLP, 1e18 - 1000);

        // Attacker donates large amount directly to pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 100000e18);

        // Second user deposits
        vm.prank(user1);
        pool.addLiquidity(10000e18, 10000e18);

        // User1 should get fair LP tokens based on reserves
        uint256 user1LP = pool.balanceOf(user1);
        assertGt(user1LP, attackerLP);

        // Remove liquidity should use internal reserves, not manipulated balance
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(user1LP);

        // Should get proportional share based on reserves, not manipulated balance
        assertGt(amountA, 0);
        assertGt(amountB, 0);
    }

    function testDonationAttackPrevented() public {
        // Setup: user1 adds liquidity
        vm.prank(user1);
        pool.addLiquidity(10000e18, 10000e18);

        uint256 user1LP = pool.balanceOf(user1);

        // Attacker donates tokens directly (donation attack)
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50000e18);

        // User1 removes liquidity - should get fair share based on reserves
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(user1LP);

        // Should get 50% of reserves, not affected by donation
        assertApproxEqAbs(amountA, 5000e18, 1e18);
        assertApproxEqAbs(amountB, 10000e18, 1e18);
    }

    function testSyncRecovery() public {
        // Setup: user1 adds liquidity
        vm.prank(user1);
        pool.addLiquidity(10000e18, 10000e18);

        // Attacker donates tokens
        vm.prank(attacker);
        tokenA.transfer(address(pool), 50000e18);

        // Sync updates reserves to match actual balances
        pool.sync();

        // Now reserves match actual balances
        assertEq(pool.reserveA(), 60000e18);
        assertEq(pool.reserveB(), 10000e18);
    }

    function testNormalAddRemoveLiquidity() public {
        // Add liquidity
        vm.prank(user1);
        pool.addLiquidity(10000e18, 10000e18);

        uint256 lpTokens = pool.balanceOf(user1);
        assertGt(lpTokens, 0);

        // Remove liquidity
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpTokens);

        assertGt(amountA, 0);
        assertGt(amountB, 0);
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract LiquidityPoolTest is Test {
    LiquidityPool pool;
    MockERC20 tokenA;
    MockERC20 tokenB;
    address attacker = address(0xbad);
    address user = address(0x1);

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        pool = new LiquidityPool(address(tokenA), address(tokenB));
        
        tokenA.mint(attacker, 1000 ether);
        tokenB.mint(attacker, 1000 ether);
        tokenA.mint(user, 100 ether);
        tokenB.mint(user, 100 ether);
    }

    function testMinimumLiquidityLock() public {
        // First depositor with tiny amount
        vm.startPrank(attacker);
        tokenA.approve(address(pool), 1);
        tokenB.approve(address(pool), 1);
        
        // sqrt(1 * 1) = 1, minus MINIMUM_LIQUIDITY(1000) < 0
        vm.expectRevert(); // Should revert due to underflow or "Insufficient liquidity"
        pool.addLiquidity(1, 1);
        vm.stopPrank();
    }

    function testFirstDepositLocksMinLiquidity() public {
        // First deposit with sufficient amount
        vm.startPrank(attacker);
        uint256 amount = 1 ether;
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);
        
        uint256 lpTokens = pool.addLiquidity(amount, amount);
        
        // MINIMUM_LIQUIDITY should be locked to address(0)
        assertEq(pool.balanceOf(address(0)), pool.MINIMUM_LIQUIDITY());
        // Attacker gets lpTokens - MINIMUM_LIQUIDITY
        assertGt(lpTokens, 0);
        vm.stopPrank();
    }

    function testRemoveLiquidityUsesInternalReserves() public {
        // Setup: first deposit
        vm.startPrank(user);
        uint256 amount = 10 ether;
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);
        pool.addLiquidity(amount, amount);
        
        uint256 lpBalance = pool.balanceOf(user);
        
        // Direct donation to manipulate balanceOf
        tokenA.transfer(address(pool), 50 ether);
        tokenB.transfer(address(pool), 50 ether);
        
        // removeLiquidity should use internal reserves, not inflated balanceOf
        uint256 reserveA_before = pool.reserveA();
        uint256 reserveB_before = pool.reserveB();
        
        pool.removeLiquidity(lpBalance);
        
        // After donation manipulation attempt, reserves should be correct
        assertLt(pool.reserveA(), reserveA_before + 50 ether);
        assertLt(pool.reserveB(), reserveB_before + 50 ether);
        vm.stopPrank();
    }

    function testSyncUpdatesReserves() public {
        // Setup
        vm.startPrank(user);
        uint256 amount = 10 ether;
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);
        pool.addLiquidity(amount, amount);
        
        // Direct donation
        tokenA.transfer(address(pool), 5 ether);
        
        uint256 reserveA_before = pool.reserveA();
        
        // Sync should update reserves to actual balances
        pool.sync();
        
        assertEq(pool.reserveA(), reserveA_before + 5 ether);
        vm.stopPrank();
    }

    function testNormalLiquidityFlow() public {
        // First deposit
        vm.startPrank(user);
        uint256 amount = 10 ether;
        tokenA.approve(address(pool), amount);
        tokenB.approve(address(pool), amount);
        uint256 lp = pool.addLiquidity(amount, amount);
        assertGt(lp, 0);
        
        // Remove liquidity
        uint256 lpBalance = pool.balanceOf(user);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpBalance);
        assertGt(outA, 0);
        assertGt(outB, 0);
        vm.stopPrank();
    }
}

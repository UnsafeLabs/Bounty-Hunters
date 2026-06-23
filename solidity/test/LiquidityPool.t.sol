// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {LiquidityPool} from "../contracts/LiquidityPool.sol";
import {MockERC20} from "./MockERC20.sol";

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;

    address alice = address(0x1);
    address bob = address(0x2);

    function setUp() public {
        tokenA = new MockERC20("TokenA", "A");
        tokenB = new MockERC20("TokenB", "B");
        pool = new LiquidityPool(address(tokenA), address(tokenB));

        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenA.mint(bob, 500 ether);
        tokenB.mint(bob, 500 ether);
    }

    function test_FirstDepositLocksMinimumLiquidity() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);

        uint256 sqrtVal = _sqrt(1000 ether * 1000 ether);
        uint256 expectedLp = sqrtVal - 1000;

        pool.addLiquidity(1000 ether, 1000 ether);

        assertEq(pool.balanceOf(address(0)), 1000);
        assertEq(pool.balanceOf(alice), expectedLp);
        assertEq(pool.totalSupply(), sqrtVal);
    }

    function test_FirstDepositorReceivesMinusLocked() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        uint256 expectedLp = _sqrt(1000 ether * 1000 ether) - 1000;
        assertEq(pool.balanceOf(alice), expectedLp);
    }

    function test_FirstDepositRejectsTooSmall() public {
        tokenA.mint(alice, 1000);
        tokenB.mint(alice, 1000);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);

        vm.expectRevert("Insufficient liquidity");
        pool.addLiquidity(1000, 1000);
    }

    function test_SubsequentDepositsProportional() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        uint256 firstLp = pool.balanceOf(alice);

        tokenA.mint(bob, 100 ether);
        tokenB.mint(bob, 100 ether);
        tokenA.connect(bob).approve(address(pool), 100 ether);
        tokenB.connect(bob).approve(address(pool), 100 ether);
        pool.connect(bob).addLiquidity(100 ether, 100 ether);

        uint256 bobLp = pool.balanceOf(bob);
        assertGt(bobLp, 0);
        assertLt(bobLp, firstLp);
    }

    function test_NoPriceManipulationViaTinyFirstDeposit() public {
        tokenA.mint(alice, 1);
        tokenB.mint(alice, 1);
        tokenA.approve(address(pool), 1);
        tokenB.approve(address(pool), 1);

        vm.expectRevert("Insufficient liquidity");
        pool.addLiquidity(1, 1);
    }

    function test_RemoveLiquidityUsesReservesNotBalance() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        uint256 lpBalance = pool.balanceOf(alice);

        tokenA.transfer(address(pool), 100 ether);

        vm.prank(alice);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpBalance);

        assertEq(amountA, 1000 ether);
        assertEq(amountB, 1000 ether);
    }

    function test_SyncUpdatesReserves() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        tokenA.transfer(address(pool), 50 ether);

        assertEq(pool.reserveA(), 1000 ether);

        pool.sync();
        assertEq(pool.reserveA(), 1050 ether);
    }

    function test_SyncEmitsEvent() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        vm.expectEmit(true, true, true, true);
        emit LiquidityPool.Sync(1000 ether, 1000 ether);
        pool.sync();
    }

    function test_DirectTransferDoesNotAffectPricing() public {
        tokenA.approve(address(pool), 1000 ether);
        tokenB.approve(address(pool), 1000 ether);
        pool.addLiquidity(1000 ether, 1000 ether);

        tokenA.transfer(address(pool), 500 ether);

        tokenA.mint(bob, 100 ether);
        tokenB.mint(bob, 100 ether);
        tokenA.connect(bob).approve(address(pool), 100 ether);
        tokenB.connect(bob).approve(address(pool), 100 ether);
        pool.connect(bob).addLiquidity(100 ether, 100 ether);

        uint256 bobLp = pool.balanceOf(bob);
        assertGt(bobLp, 0);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
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

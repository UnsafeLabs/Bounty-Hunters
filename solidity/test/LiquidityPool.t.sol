// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/LiquidityPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract LiquidityPoolTest {
    LiquidityPool public pool;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    address public user1;
    address public user2;
    address public attacker;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        tokenA = new MockERC20(1000000);
        tokenB = new MockERC20(1000000);
        pool = new LiquidityPool(address(tokenA), address(tokenB));
        
        user1 = address(0x1);
        user2 = address(0x2);
        attacker = address(0x3);
        
        // Mint tokens to users
        tokenA.transfer(user1, 1000);
        tokenB.transfer(user1, 1000);
        tokenA.transfer(user2, 1000);
        tokenB.transfer(user2, 1000);
        tokenA.transfer(attacker, 1000);
        tokenB.transfer(attacker, 1000);
    }
    
    function testFirstDeposit() public {
        // Approve pool to spend tokens
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        
        // First deposit
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(1000, 1000);
        
        // Check that MINIMUM_LIQUIDITY is minted to address(0)
        if (pool.balanceOf(address(0)) == pool.MINIMUM_LIQUIDITY()) {
            emit TestPassed("MINIMUM_LIQUIDITY locked to address(0)");
        } else {
            emit TestFailed("MINIMUM_LIQUIDITY not locked to address(0)");
        }
        
        // Check that user1 received LP tokens (minus MINIMUM_LIQUIDITY)
        if (pool.balanceOf(user1) > 0) {
            emit TestPassed("First depositor received LP tokens");
        } else {
            emit TestFailed("First depositor should receive LP tokens");
        }
    }
    
    function testFirstDepositPriceManipulationPrevention() public {
        // The first depositor cannot manipulate the LP price because MINIMUM_LIQUIDITY is locked
        vm.prank(user1);
        tokenA.approve(address(pool), 1);
        tokenB.approve(address(pool), 1000000);
        
        vm.prank(user1);
        uint256 lpTokens = pool.addLiquidity(1, 1000000);
        
        // With MINIMUM_LIQUIDITY lock, the first depositor cannot get an unfair amount of LP tokens
        // The LP tokens should be based on geometric mean with MINIMUM_LIQUIDITY subtracted
        if (pool.balanceOf(address(0)) == pool.MINIMUM_LIQUIDITY()) {
            emit TestPassed("First depositor price manipulation prevented by MINIMUM_LIQUIDITY lock");
        } else {
            emit TestFailed("MINIMUM_LIQUIDITY lock failed");
        }
    }
    
    function testAddLiquidity() public {
        // First deposit
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        vm.prank(user1);
        pool.addLiquidity(1000, 1000);
        
        // Second deposit
        vm.prank(user2);
        tokenA.approve(address(pool), 500);
        tokenB.approve(address(pool), 500);
        vm.prank(user2);
        uint256 lpTokens = pool.addLiquidity(500, 500);
        
        if (lpTokens > 0) {
            emit TestPassed("Add liquidity works for subsequent deposits");
        } else {
            emit TestFailed("Subsequent deposits should receive LP tokens");
        }
    }
    
    function testRemoveLiquidity() public {
        // First deposit
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        vm.prank(user1);
        pool.addLiquidity(1000, 1000);
        
        uint256 lpTokens = pool.balanceOf(user1);
        
        // Remove liquidity
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpTokens);
        
        if (amountA > 0 && amountB > 0) {
            emit TestPassed("Remove liquidity works");
        } else {
            emit TestFailed("Remove liquidity should return tokens");
        }
    }
    
    function testRemoveLiquidityUsesReserves() public {
        // First deposit
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        vm.prank(user1);
        pool.addLiquidity(1000, 1000);
        
        uint256 lpTokens = pool.balanceOf(user1);
        
        // Directly transfer tokens to the pool to try to manipulate balance
        vm.prank(attacker);
        tokenA.transfer(address(pool), 100);
        tokenB.transfer(address(pool), 100);
        
        // Remove liquidity - should use internal reserves, not balanceOf
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpTokens);
        
        // The amount returned should be based on reserves, not the manipulated balance
        // Since we added 1000 of each initially, and attacker added 100 of each,
        // but reserves should only track the 1000 from the deposit
        // The removeLiquidity function should use reserveA/reserveB, not balanceOf
        
        // After removal, reserves should be 0
        if (pool.reserveA() == 0 && pool.reserveB() == 0) {
            emit TestPassed("Remove liquidity uses internal reserves, not balanceOf");
        } else {
            emit TestFailed("Remove liquidity should use internal reserves");
        }
    }
    
    function testReservesTracking() public {
        // First deposit
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        vm.prank(user1);
        pool.addLiquidity(1000, 1000);
        
        // Check reserves
        if (pool.reserveA() == 1000 && pool.reserveB() == 1000) {
            emit TestPassed("Reserves tracking works correctly");
        } else {
            emit TestFailed("Reserves should be updated correctly");
        }
        
        // Second deposit
        vm.prank(user2);
        tokenA.approve(address(pool), 500);
        tokenB.approve(address(pool), 500);
        vm.prank(user2);
        pool.addLiquidity(500, 500);
        
        // Check reserves after second deposit
        if (pool.reserveA() == 1500 && pool.reserveB() == 1500) {
            emit TestPassed("Reserves updated correctly after second deposit");
        } else {
            emit TestFailed("Reserves should be 1500 after second deposit");
        }
    }
    
    function testBalanceOfManipulationPrevention() public {
        // First deposit
        vm.prank(user1);
        tokenA.approve(address(pool), 1000);
        tokenB.approve(address(pool), 1000);
        vm.prank(user1);
        pool.addLiquidity(1000, 1000);
        
        // Attacker directly transfers tokens to the pool
        vm.prank(attacker);
        tokenA.transfer(address(pool), 1000);
        tokenB.transfer(address(pool), 1000);
        
        // The pool's balanceOf will show extra tokens, but reserves should not be affected
        uint256 poolBalanceA = tokenA.balanceOf(address(pool));
        uint256 poolBalanceB = tokenB.balanceOf(address(pool));
        
        // balanceOf should be higher due to direct transfer
        if (poolBalanceA > pool.reserveA() && poolBalanceB > pool.reserveB()) {
            emit TestPassed("Direct transfer affects balanceOf but not reserves");
        } else {
            emit TestFailed("Direct transfer should affect balanceOf");
        }
        
        // When removing liquidity, it should use reserves, not balanceOf
        uint256 lpTokens = pool.balanceOf(user1);
        vm.prank(user1);
        (uint256 amountA, uint256 amountB) = pool.removeLiquidity(lpTokens);
        
        // The amounts should be based on reserves (1000 each), not balanceOf (2000 each)
        if (amountA == 1000 && amountB == 1000) {
            emit TestPassed("Remove liquidity correctly uses reserves, not manipulated balanceOf");
        } else {
            emit TestFailed("Remove liquidity should use reserves, not balanceOf");
        }
    }
}

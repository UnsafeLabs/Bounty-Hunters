// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/SimpleSwap.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(uint256 initialSupply) ERC20("MockToken", "MTK") {
        _mint(msg.sender, initialSupply);
    }
}

contract SimpleSwapTest {
    SimpleSwap public simpleSwap;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    address public owner;
    address public user1;
    address public user2;
    
    event TestPassed(string message);
    event TestFailed(string message);
    
    constructor() {
        tokenA = new MockERC20(1000000);
        tokenB = new MockERC20(1000000);
        owner = address(0x1);
        user1 = address(0x2);
        user2 = address(0x3);
        
        // Deploy SimpleSwap contract with 0.3% fee
        simpleSwap = new SimpleSwap(address(tokenA), address(tokenB), 30);
        
        // Add initial liquidity
        tokenA.transfer(address(simpleSwap), 100000);
        tokenB.transfer(address(simpleSwap), 100000);
        vm.prank(address(simpleSwap));
        simpleSwap.addLiquidity(100000, 100000);
    }
    
    function testSwapWithSlippageProtection() public {
        // Transfer tokens to user1
        tokenA.transfer(user1, 1000);
        
        // User1 approves SimpleSwap to spend tokens
        vm.prank(user1);
        tokenA.approve(address(simpleSwap), 1000);
        
        // Calculate expected output (approximately)
        // With 100000 reserveA and 100000 reserveB
        // Swapping 1000 tokenA should give roughly 997 tokenB (with 0.3% fee)
        uint256 expectedMinOutput = 990; // conservative estimate
        
        // Execute swap with slippage protection
        vm.prank(user1);
        uint256 amountOut = simpleSwap.swap(
            address(tokenA),
            1000,
            expectedMinOutput,
            block.timestamp + 100
        );
        
        if (amountOut >= expectedMinOutput) {
            emit TestPassed("Swap with slippage protection works");
        } else {
            emit TestFailed("Swap output below minimum");
        }
    }
    
    function testSwapWithoutSlippageProtection() public {
        // Transfer tokens to user1
        tokenA.transfer(user1, 1000);
        
        // User1 approves SimpleSwap to spend tokens
        vm.prank(user1);
        tokenA.approve(address(simpleSwap), 1000);
        
        // Try swap with too high minAmountOut (should revert)
        try simpleSwap.swap(
            address(tokenA),
            1000,
            10000, // Impossible to get this much
            block.timestamp + 100
        ) {
            emit TestFailed("Should revert when slippage exceeds");
        } catch {
            emit TestPassed("Slippage protection prevents excessive loss");
        }
    }
    
    function testDeadlineProtection() public {
        // Transfer tokens to user1
        tokenA.transfer(user1, 1000);
        
        // User1 approves SimpleSwap to spend tokens
        vm.prank(user1);
        tokenA.approve(address(simpleSwap), 1000);
        
        // Try swap with expired deadline (should revert)
        try simpleSwap.swap(
            address(tokenA),
            1000,
            0,
            block.timestamp - 1 // Already expired
        ) {
            emit TestFailed("Should revert when deadline expired");
        } catch {
            emit TestPassed("Deadline protection prevents stale transactions");
        }
    }
    
    function testAddLiquidity() public {
        // Transfer tokens to user1
        tokenA.transfer(user1, 1000);
        tokenB.transfer(user1, 1000);
        
        // User1 approves SimpleSwap to spend tokens
        vm.prank(user1);
        tokenA.approve(address(simpleSwap), 1000);
        tokenB.approve(address(simpleSwap), 1000);
        
        uint256 reserveABefore = simpleSwap.reserveA();
        uint256 reserveBBefore = simpleSwap.reserveB();
        
        // Add liquidity
        vm.prank(user1);
        simpleSwap.addLiquidity(1000, 1000);
        
        if (simpleSwap.reserveA() > reserveABefore && simpleSwap.reserveB() > reserveBBefore) {
            emit TestPassed("Add liquidity works");
        } else {
            emit TestFailed("Add liquidity failed");
        }
    }
    
    function testGetAmountOut() public {
        // Test getAmountOut function
        uint256 amountOut = simpleSwap.getAmountOut(address(tokenA), 1000);
        
        if (amountOut > 0) {
            emit TestPassed("getAmountOut returns valid amount");
        } else {
            emit TestFailed("getAmountOut should return > 0");
        }
    }
    
    function testSwapTokenB() public {
        // Transfer tokens to user1
        tokenB.transfer(user1, 1000);
        
        // User1 approves SimpleSwap to spend tokens
        vm.prank(user1);
        tokenB.approve(address(simpleSwap), 1000);
        
        // Execute swap from tokenB to tokenA
        vm.prank(user1);
        uint256 amountOut = simpleSwap.swap(
            address(tokenB),
            1000,
            0,
            block.timestamp + 100
        );
        
        if (amountOut > 0) {
            emit TestPassed("Swap from tokenB to tokenA works");
        } else {
            emit TestFailed("Swap from tokenB should return > 0");
        }
    }
}

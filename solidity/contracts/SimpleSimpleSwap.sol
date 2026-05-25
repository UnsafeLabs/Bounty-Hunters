// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "hardhat/console.sol";

contract SimpleSwap {
    uint256 public fee = 30; // 0.3% in basis points
    
    // Calculate amount of output token user should receive
    function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut, uint256 minAmountOut, uint256 deadline) public view returns (uint256) {
        require(block.timestamp <= deadline, "Transaction expired");
        return (amountIn * (10000 - fee)) / 10000; // Fixed point math for fee calculation
    }
    
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) public returns (uint256) {
        // Calculate the output amount based on input
        uint256 amountOut = getAmountOut(tokenIn, tokenOut, amountIn, minAmountOut, block.timestamp);
        return amountOut;
    }
}
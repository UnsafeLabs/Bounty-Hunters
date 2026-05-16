// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleSwap {
    address public owner;
    uint256 public reserveIn;
    uint256 public reserveOut;
    uint256 public constant FEE_BPS = 30;

    event Swap(
        address indexed user,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut,
        uint256 deadline
    );
    event LiquidityAdded(address indexed provider, uint256 amountIn, uint256 amountOut);
    event LiquidityRemoved(address indexed provider, uint256 amountIn, uint256 amountOut);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addLiquidity(uint256 amountIn, uint256 amountOut) external onlyOwner {
        reserveIn += amountIn;
        reserveOut += amountOut;
        emit LiquidityAdded(msg.sender, amountIn, amountOut);
    }

    function removeLiquidity(uint256 amountIn, uint256 amountOut) external onlyOwner {
        require(reserveIn >= amountIn && reserveOut >= amountOut, "Insufficient reserves");
        reserveIn -= amountIn;
        reserveOut -= amountOut;
        emit LiquidityRemoved(msg.sender, amountIn, amountOut);
    }

    function swap(
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Amount in must be positive");
        require(minAmountOut > 0, "Minimum amount out must be positive");
        require(reserveIn > 0 && reserveOut > 0, "Pool not initialized");

        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);

        require(amountOut >= minAmountOut, "Slippage exceeded");

        reserveIn += amountIn;
        reserveOut -= amountOut;

        emit Swap(msg.sender, amountIn, amountOut, minAmountOut, deadline);
    }

    function getAmountOut(uint256 amountIn) external view returns (uint256) {
        require(reserveIn > 0 && reserveOut > 0, "Pool not initialized");
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
        return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
    }
}
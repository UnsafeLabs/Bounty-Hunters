// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
    }

    /// @notice Swap one token for another with slippage and deadline protection
    /// @param tokenIn The address of the token to swap in
    /// @param amountIn The amount of input tokens
    /// @param minAmountOut The minimum acceptable output amount (slippage protection)
    /// @param deadline The transaction deadline timestamp (front-running protection)
    /// @return amountOut The amount of output tokens received
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");
        require(block.timestamp <= deadline, "Transaction expired");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            ? (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        // Fixed-point fee calculation: multiply first, then divide to minimize precision loss
        // Uses full 256-bit intermediate to prevent overflow for large amounts
        uint256 amountInAfterFee = _applyFee(amountIn);

        // constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        // Slippage protection: revert if output is below the minimum acceptable amount
        require(amountOut >= minAmountOut, "Slippage exceeded");

        outputToken.transfer(msg.sender, amountOut);

        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    /// @notice Calculate the output amount for a given input (including fee)
    /// @param tokenIn The address of the input token
    /// @param amountIn The amount of input tokens
    /// @return The expected output amount
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        uint256 amountInAfterFee = _applyFee(amountIn);
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }

    /// @dev Internal function to apply fee using fixed-point math
    /// Multiplies before dividing to preserve precision for small amounts
    function _applyFee(uint256 amountIn) internal view returns (uint256) {
        // fee is in basis points (e.g. 30 = 0.3%)
        // amountInAfterFee = amountIn * (10000 - fee) / 10000
        // This order of operations minimizes truncation loss
        return (amountIn * (10000 - fee)) / 10000;
    }
}

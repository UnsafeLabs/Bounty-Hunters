// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%
    uint256 public constant FEE_PRECISION = 10_000;
    uint256 public constant MIN_FEE_BASIS_POINTS = 1; // minimum 1 bp to prevent truncation

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

    /// @notice Swap tokens with slippage protection and deadline
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of input tokens to swap
    /// @param minAmountOut Minimum acceptable output amount (slippage protection)
    /// @param deadline Unix timestamp after which the transaction reverts
    /// @return amountOut The actual output amount received
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "SimpleSwap: expired deadline");
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "SimpleSwap: invalid token");
        require(amountIn > 0, "SimpleSwap: amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        // Fee calculation with precision protection:
        // For small amounts, ensure at least 1 bp is charged
        uint256 effectiveBasisPoints = fee;
        uint256 rawFee = amountIn * effectiveBasisPoints / FEE_PRECISION;
        if (rawFee == 0 && effectiveBasisPoints > 0) {
            // Minimum fee: charge 1 unit when fee > 0 but truncates to zero
            rawFee = 1;
        }
        uint256 amountInAfterFee = amountIn - rawFee;

        // constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        require(amountOut >= minAmountOut, "SimpleSwap: slippage exceeded");

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

    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        uint256 effectiveBasisPoints = fee;
        uint256 rawFee = amountIn * effectiveBasisPoints / FEE_PRECISION;
        if (rawFee == 0 && effectiveBasisPoints > 0) {
            rawFee = 1;
        }
        uint256 amountInAfterFee = amountIn - rawFee;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}

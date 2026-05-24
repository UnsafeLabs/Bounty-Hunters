// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%
    uint256 public constant MIN_FEE = 1; // minimum fee of 1 unit to prevent zero-fee swaps

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

    // FIX: Added minAmountOut and deadline parameters
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");
        require(block.timestamp <= deadline, "Transaction expired");
        require(minAmountOut > 0, "minAmountOut must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        // FIX: Use proper fixed-point math to avoid precision loss
        // amountOut = (reserveOut * amountIn * (10000 - fee)) / (reserveIn * 10000 + amountIn * (10000 - fee))
        uint256 feeAmount = (amountIn * fee) / 10000;
        // Ensure minimum fee to prevent zero-fee exploitation
        if (feeAmount < MIN_FEE && amountIn >= MIN_FEE) {
            feeAmount = MIN_FEE;
        }
        uint256 amountInAfterFee = amountIn - feeAmount;

        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        // FIX: Slippage protection
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut > 0, "Insufficient output amount");
        require(amountOut < reserveOut, "Insufficient liquidity");

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
        uint256 feeAmount = (amountIn * fee) / 10000;
        if (feeAmount < MIN_FEE && amountIn >= MIN_FEE) {
            feeAmount = MIN_FEE;
        }
        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SimpleSwap is ReentrancyGuard {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public constant FEE_NUMERATOR = 3;
    uint256 public constant FEE_DENOMINATOR = 1000;

    event Swap(address indexed sender, address tokenIn, uint256 amountIn, uint256 amountOut);
    event ReservesUpdated(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    // FIX: Add slippage protection and deadline, fix fee precision
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant {
        require(deadline >= block.timestamp, "Expired");
        require(amountIn > 0, "Amount must be > 0");
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");

        address tokenOut = tokenIn == address(tokenA) ? address(tokenB) : address(tokenA);
        uint256 reserveIn = tokenIn == address(tokenA) ? reserveA : reserveB;
        uint256 reserveOut = tokenIn == address(tokenA) ? reserveB : reserveA;

        require(reserveIn > 0 && reserveOut > 0, "No liquidity");

        // FIX: Proper fee calculation with precision
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_NUMERATOR);
        uint256 amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);

        // FIX: Slippage protection
        require(amountOut >= minAmountOut, "Slippage exceeded");

        // Effects
        if (tokenIn == address(tokenA)) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        // Interactions
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
        emit ReservesUpdated(reserveA, reserveB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
        emit ReservesUpdated(reserveA, reserveB);
    }

    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256) {
        uint256 reserveIn = tokenIn == address(tokenA) ? reserveA : reserveB;
        uint256 reserveOut = tokenIn == address(tokenA) ? reserveB : reserveA;
        if (reserveIn == 0 || reserveOut == 0) return 0;
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_NUMERATOR);
        return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }
}

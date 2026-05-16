// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SimpleSwap is ReentrancyGuard {
    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    error InsufficientOutput(uint256 actual, uint256 minRequired);
    error Expired(uint256 blockTimestamp, uint256 deadline);
    error InvalidToken();

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
    }

    // FIX: Added minAmountOut, deadline, and ReentrancyGuard
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        // Check deadline
        require(block.timestamp <= deadline, "Swap expired");
        
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        // constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        // Check slippage protection
        require(amountOut >= minAmountOut, "Insufficient output amount");

        // State update BEFORE external call
        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);

        // External call after state update
        outputToken.transfer(msg.sender, amountOut);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleSwap
 * @notice Constant-product AMM with slippage protection and SafeERC20
 * @dev Fixes:
 *   - minAmountOut parameter prevents sandwich attacks
 *   - deadline parameter prevents stale transaction execution
 *   - SafeERC20 replaces raw transfer/transferFrom calls
 *   - Minimum fee of 1 token unit prevents zero-fee exploits
 *   - ReentrancyGuard on swap and addLiquidity
 */
contract SimpleSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    uint256 public constant MIN_FEE_AMOUNT = 1; // minimum fee in token units

    event Swap(
        address indexed user,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 deadline
    );
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB
    );

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid tokens");
        require(_tokenA != _tokenB, "Tokens must differ");
        require(_fee <= 1000, "Fee too high"); // max 10%
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    /**
     * @notice Swap tokens with slippage and deadline protection
     * @param tokenIn Address of input token
     * @param amountIn Amount of input token to swap
     * @param minAmountOut Minimum output tokens to accept (slippage protection)
     * @param deadline Block timestamp after which the swap reverts
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 feeAmount = amountIn * fee / 10000;
        if (feeAmount < MIN_FEE_AMOUNT && fee > 0) {
            feeAmount = MIN_FEE_AMOUNT;
        }
        uint256 amountInAfterFee = amountIn - feeAmount;

        // constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut > 0, "Zero output");

        outputToken.safeTransfer(msg.sender, amountOut);

        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut, deadline);
    }

    function getAmountOut(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        if (reserveIn == 0 || reserveOut == 0) return 0;
        uint256 feeAmount = amountIn * fee / 10000;
        if (feeAmount < MIN_FEE_AMOUNT && fee > 0) {
            feeAmount = MIN_FEE_AMOUNT;
        }
        if (amountIn <= feeAmount) return 0;
        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}

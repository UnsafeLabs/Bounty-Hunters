// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SimpleSwap {
    uint256 private constant FEE_DENOMINATOR = 10_000;

    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        require(_fee < FEE_DENOMINATOR, "Invalid fee");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "TokenA transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "TokenB transfer failed");
        reserveA += amountA;
        reserveB += amountB;
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Amount must be > 0");

        (bool isTokenA, uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn);
        IERC20 inputToken = isTokenA ? tokenA : tokenB;
        IERC20 outputToken = isTokenA ? tokenB : tokenA;

        amountOut = _quoteAmountOut(reserveIn, reserveOut, amountIn);
        require(amountOut > 0, "Insufficient output");
        require(amountOut >= minAmountOut, "Slippage exceeded");

        require(inputToken.transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");

        if (isTokenA) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        require(outputToken.transfer(msg.sender, amountOut), "Output transfer failed");

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        require(amountIn > 0, "Amount must be > 0");
        (, uint256 reserveIn, uint256 reserveOut) = _reservesFor(tokenIn);
        return _quoteAmountOut(reserveIn, reserveOut, amountIn);
    }

    function _reservesFor(address tokenIn)
        internal
        view
        returns (bool isTokenA, uint256 reserveIn, uint256 reserveOut)
    {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");

        isTokenA = tokenIn == address(tokenA);
        return (
            isTokenA,
            isTokenA ? reserveA : reserveB,
            isTokenA ? reserveB : reserveA
        );
    }

    function _quoteAmountOut(uint256 reserveIn, uint256 reserveOut, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - fee);
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        return Math.mulDiv(reserveOut, amountInWithFee, denominator);
    }
}

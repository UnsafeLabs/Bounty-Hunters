// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SimpleSwap {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10000;

    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token");
        require(_tokenA != _tokenB, "Duplicate token");
        require(_fee <= BPS_DENOMINATOR, "Invalid fee");

        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(amountA > 0 && amountB > 0, "Invalid liquidity");

        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Deadline expired");
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        amountOut = _getAmountOut(reserveIn, reserveOut, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);
        outputToken.safeTransfer(msg.sender, amountOut);

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
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        return _getAmountOut(reserveIn, reserveOut, amountIn);
    }

    function calculateFee(uint256 amountIn) public view returns (uint256) {
        if (fee == 0) return 0;
        return Math.ceilDiv(amountIn * fee, BPS_DENOMINATOR);
    }

    function _getAmountOut(
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amountIn
    ) private view returns (uint256) {
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 feeAmount = calculateFee(amountIn);
        require(amountIn > feeAmount, "Amount too small");

        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}

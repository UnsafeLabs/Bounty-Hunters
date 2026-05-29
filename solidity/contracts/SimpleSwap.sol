// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwap {
    uint256 public constant FEE_DENOMINATOR = 10000;

    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token");
        require(_tokenA != _tokenB, "Duplicate tokens");
        require(_fee < FEE_DENOMINATOR, "Invalid fee");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external {
        require(amountA > 0 && amountB > 0, "Invalid liquidity");
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
        require(block.timestamp <= deadline, "Deadline expired");
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        IERC20 inputToken = isTokenA ? tokenA : tokenB;
        IERC20 outputToken = isTokenA ? tokenB : tokenA;

        amountOut = _getAmountOut(tokenIn, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        require(inputToken.transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");
        require(outputToken.transfer(msg.sender, amountOut), "Output transfer failed");

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
        return _getAmountOut(tokenIn, amountIn);
    }

    function _getAmountOut(address tokenIn, uint256 amountIn) internal view returns (uint256) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 feeAmount = _calculateFee(amountIn);
        uint256 amountInAfterFee = amountIn - feeAmount;
        require(amountInAfterFee > 0, "Amount too small after fee");

        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }

    function _calculateFee(uint256 amountIn) internal view returns (uint256) {
        if (fee == 0) {
            return 0;
        }
        return (amountIn * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
    }
}

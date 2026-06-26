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

    // BUG: No minAmountOut parameter — vulnerable to sandwich attacks
    // BUG: No deadline parameter — stale transactions can be executed
    // BUG: Fee calculation truncates to zero for small amounts
    function swap(address tokenIn, uint256 amountIn) external returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "Amount must be > 0");

        bool isTokenA = tokenIn == address(tokenA);
        (IERC20 inputToken, IERC20 outputToken, uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (tokenA, tokenB, reserveA, reserveB)
            : (tokenB, tokenA, reserveB, reserveA);

        inputToken.transferFrom(msg.sender, address(this), amountIn);

        tokenB = _tokenB;
    }

    function swap(uint256 amountIn, uint256 minAmountOut, uint256 deadline, bool aToB) external {
        require(amountIn > 0, "Amount must be greater than 0");

        IERC20 inputToken = aToB ? tokenA : tokenB;
        uint256 inputReserve = inputToken.balanceOf(address(this));
        uint256 outputReserve = outputToken.balanceOf(address(this));

        require(block.timestamp <= deadline, "Transaction expired");

        uint256 amountOut = getAmountOut(amountIn, inputReserve, outputReserve);

        require(amountOut >= minAmountOut, "Slippage exceeded");

        uint256 feeAmount = (amountIn * fee) / 10000;
        uint256 amountInAfterFee = (amountIn * (10000 - fee)) / 10000;
        require(amountInAfterFee > 0, "Amount too small after fee");

        inputToken.transferFrom(msg.sender, address(this), amountIn);
        outputToken.transfer(msg.sender, amountOut);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        uint256 fee = 30;
        uint256 amountInWithFee = amountIn * (10000 - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;
        return numerator / denominator;
}

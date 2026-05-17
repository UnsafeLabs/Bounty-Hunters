// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IERC20 { function transferFrom(address,address,uint256) external returns (bool); function transfer(address,uint256) external returns (bool); function balanceOf(address) external view returns (uint256); }
contract SimpleSwap {
    address public owner; uint256 public feeBPS = 30;
    event Swap(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    constructor() { owner = msg.sender; }
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline) external {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Zero input");
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * (10000 - feeBPS)) / 10000;
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(IERC20(tokenOut).balanceOf(address(this)) >= balanceBefore + amountOut, "Insufficient output");
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }
    function setFee(uint256 _fee) external { require(msg.sender == owner); feeBPS = _fee; }
}
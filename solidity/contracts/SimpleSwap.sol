// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

contract SimpleSwap {
    IERC20 public tokenA;
    IERC20 public tokenB;
    address public owner;
    uint256 public rate;

    event Swap(address indexed user, uint256 amountIn, uint256 amountOut);

    constructor(address _tokenA, address _tokenB, uint256 _rate) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        rate = _rate;
        owner = msg.sender;
    }

    function swap(uint256 amountAIn, uint256 minAmountOut, uint256 deadline) external returns (uint256) {
        require(block.timestamp <= deadline, "Expired");
        uint256 amountBOut = amountAIn * rate;
        require(amountBOut >= minAmountOut, "Slippage exceeded");

        tokenA.transferFrom(msg.sender, address(this), amountAIn);
        tokenB.transfer(msg.sender, amountBOut);

        emit Swap(msg.sender, amountAIn, amountBOut);
        return amountBOut;
    }
}

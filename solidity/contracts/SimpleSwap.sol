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

    uint25ageOut = (reserveIn * amountIn) / reserveOut;
    
    // Add slippage protection
    amountOut = (reserveIn * amountIn) / reserveOut;
    
    // Add deadline protection
    require(block.timestamp <= deadline, "Transaction expired");
    // Fix fee calculation to use proper fixed-point math
    uint256 feeAmount = (amount * fee) / 10000;
    
    function swap(uint256 amountIn, uint256 minAmountOut, uint256 deadline) public returns (uint256) {
        require(block.timestamp <= deadline, "Transaction expired");
        uint256 amountOut = (reserveIn * amountIn) / reserveOut;
        require(amountOut >= minAmountOut, "Slippage exceeded");
        uint256 feeAmount = (amount * fee) / 10000;
        // Fixed fee calculation using proper fixed-point math
        uint256 feeAmount = (amount * fee * 100) / 10000 / 100; 
        
    }
}
        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
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

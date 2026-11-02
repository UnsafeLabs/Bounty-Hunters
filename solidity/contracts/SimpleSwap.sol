// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract SimpleSwap {
    using SafeMath for uint256;
    
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    uint256 public fee; // basis points (e.g., 30 = 0.3%)
    address public feeCollector;
    
    event Swapped(address indexed sender, uint256 amountIn, uint256 amountOut, address tokenIn, address tokenOut);
    event FeeUpdated(uint256 newFee);
    
    constructor(address _tokenA, address _tokenB, uint256 _fee, address _feeCollector) {
        require(_tokenA != _tokenB, "Identical tokens");
        require(_fee <= 10000, "Fee too high");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
        feeCollector = _feeCollector;
    }
    
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Deadline expired");
        require(amountIn > 0, "Zero amount");
        require(minAmountOut > 0, "Zero minAmountOut");
        
        IERC20 tokenOut = tokenIn == address(tokenA) ? tokenB : tokenA;
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        
        // Transfer input tokens
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Transfer in failed");
        
        // Calculate output with fixed-point precision for fee
        // amountOut = (amountIn * (10000 - fee)) / 10000
        // Using SafeMath and proper precision
        uint256 feeAmount = (amountIn * fee) / 10000;
        amountOut = amountIn - feeAmount;
        
        // Check slippage
        require(amountOut >= minAmountOut, "Slippage exceeded");
        
        // Transfer fee to collector if > 0
        if (feeAmount > 0) {
            require(IERC20(tokenIn).transfer(feeCollector, feeAmount), "Fee transfer failed");
        }
        
        // Transfer output to user
        require(tokenOut.transfer(msg.sender, amountOut), "Transfer out failed");
        
        emit Swapped(msg.sender, amountIn, amountOut, tokenIn, tokenOut);
        return amountOut;
    }
    
    function setFee(uint256 _fee) external onlyOwner {
        require(_fee <= 10000, "Fee too high");
        fee = _fee;
        emit FeeUpdated(_fee);
    }
    
    function setFeeCollector(address _collector) external onlyOwner {
        require(_collector != address(0), "Invalid collector");
        feeCollector = _collector;
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleSwap
 * @notice AMM with slippage protection and deadline
 * @dev Fixes:
 *   - Added SafeERC20 for all transfers
 *   - Added minAmountOut for slippage protection
 *   - Added deadline parameter
 *   - Added sync/skim functions
 *   - Added ReentrancyGuard
 */
contract SimpleSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public tokenA;
    IERC20 public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public fee; // basis points, e.g. 30 = 0.3%

    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed user, uint256 amountA, uint256 amountB);
    event Sync(uint256 reserveA, uint256 reserveB);

    constructor(address _tokenA, address _tokenB, uint256 _fee) Ownable(msg.sender) {
        require(_tokenA != address(0), "Invalid token A");
        require(_tokenB != address(0), "Invalid token B");
        require(_fee <= 1000, "Fee too high"); // Max 10%
        
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    /**
     * @notice Add liquidity
     * @param amountA Amount of token A
     * @param amountB Amount of token B
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");
        
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        
        reserveA += amountA;
        reserveB += amountB;
        
        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    /**
     * @notice Swap tokens with slippage protection
     * @param tokenIn Token to swap in
     * @param amountIn Amount to swap
     * @param minAmountOut Minimum amount to receive
     * @param deadline Transaction deadline
     * @return amountOut Amount received
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

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        // Constant product formula: x * y = k
        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);

        // Slippage protection
        require(amountOut >= minAmountOut, "Insufficient output amount");

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

    /**
     * @notice Get expected output amount
     * @param tokenIn Token to swap in
     * @param amountIn Amount to swap
     * @return Expected output amount
     */
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;
        uint256 feeAmount = amountIn * fee / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;
        return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }

    /**
     * @notice Sync reserves with actual balances
     */
    function sync() external onlyOwner {
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
        emit Sync(reserveA, reserveB);
    }

    /**
     * @notice Skim excess tokens to owner
     */
    function skim() external onlyOwner {
        uint256 excessA = tokenA.balanceOf(address(this)) - reserveA;
        uint256 excessB = tokenB.balanceOf(address(this)) - reserveB;
        
        if (excessA > 0) tokenA.safeTransfer(owner(), excessA);
        if (excessB > 0) tokenB.safeTransfer(owner(), excessB);
    }
}

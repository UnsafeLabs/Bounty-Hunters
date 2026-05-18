solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SimpleSwap - A basic constant product automated market maker
/// @notice This contract provides a simplified swap function with slippage protection, deadline, and precise fee calculation.
/// @dev Uses OpenZeppelin's SafeERC20 and ReentrancyGuard. Fee is expressed in basis points (1/100 of a percent).
contract SimpleSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------
    // Events
    // ----------------------------------
    event Swap(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );

    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB
    );

    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB
    );

    // ----------------------------------
    // State variables
    // ----------------------------------
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    uint256 public immutable fee; // in basis points (e.g., 30 = 0.3%)
    uint256 public reserveA;
    uint256 public reserveB;

    // ----------------------------------
    // Errors
    // ----------------------------------
    error InvalidInput();
    error InsufficientOutputAmount(uint256 expected, uint256 actual);
    error Expired(uint256 deadline, uint256 currentTimestamp);
    error InsufficientLiquidity(uint256 available, uint256 required);
    error ZeroAddress();
    error InvalidFee(uint256 fee);

    // ----------------------------------
    // Constructor
    // ----------------------------------
    /// @notice Deploys the swap contract with the given token pair and fee
    /// @param _tokenA Address of the first token
    /// @param _tokenB Address of the second token
    /// @param _fee Fee in basis points (max 10000 = 100%)
    constructor(address _tokenA, address _tokenB, uint256 _fee) {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_fee > 10000) revert InvalidFee(_fee);
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    // ----------------------------------
    // External functions
    // ----------------------------------

    /// @notice Adds liquidity to the pool. The caller must have approved both tokens.
    /// @param amountA Amount of tokenA to deposit
    /// @param amountB Amount of tokenB to deposit
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        if (amountA == 0 || amountB == 0) revert InvalidInput();

        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    /// @notice Removes liquidity proportionally. The caller receives both tokens.
    /// @param amountA Amount of tokenA to withdraw
    /// @param amountB Amount of tokenB to withdraw
    function removeLiquidity(uint256 amountA, uint256 amountB) external {
        if (amountA == 0 || amountB == 0) revert InvalidInput();
        if (amountA > reserveA || amountB > reserveB) revert InsufficientLiquidity(
            amountA > reserveA ? reserveA : reserveB,
            amountA > reserveA ? amountA : amountB
        );

        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB);
    }

    /// @notice Swaps an exact amount of input tokens for output tokens.
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of input tokens to swap
    /// @param minAmountOut Minimum amount of output tokens expected (slippage protection)
    /// @param deadline Timestamp after which the transaction is considered expired
    /// @return amountOut The actual amount of output tokens received
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        // 1. Deadline check
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);

        // 2. Input validation
        if (tokenIn != address(tokenA) && tokenIn != address(tokenB)) revert InvalidInput();
        if (amountIn == 0) revert InvalidInput();

        // 3. Determine reserves and output token
        address tokenOut;
        uint256 reserveIn;
        uint256 reserveOut;
        if (tokenIn == address(tokenA)) {
            tokenOut = address(tokenB);
            reserveIn = reserveA;
            reserveOut = reserveB;
        } else {
            tokenOut = address(tokenA);
            reserveIn = reserveB;
            reserveOut = reserveA;
        }

        // 4. Calculate fee amount with ceiling division to avoid precision loss
        //    feeBps / 10000 = fee / 10000
        //    feeAmount = ceil(amountIn * fee / 10000)
        //    Equivalent to (amountIn * fee + 10000 - 1) / 10000
        uint256 feeAmount = (amountIn * fee + 10000 - 1) / 10000; // rounds up
        uint256 amountInAfterFee = amountIn - feeAmount;

        if (amountInAfterFee == 0) {
            // If after fee there is nothing, no output
            amountOut = 0;
        } else {
            // 5. Calculate output using constant product formula: x * y = k
            //    amountOut = reserveOut * amountInAfterFee / (reserveIn + amountInAfterFee)
            //    Full precision using division before multiplication to avoid overflow
            amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
        }

        // 6. Slippage check
        if (amountOut < minAmountOut) revert InsufficientOutputAmount(minAmountOut, amountOut);

        // 7. Update reserves (internal accounting)
        if (tokenIn == address(tokenA)) {
            reserveA += amountIn;
            reserveB -= amountOut;
        } else {
            reserveB += amountIn;
            reserveA -= amountOut;
        }

        // 8. Transfer tokens
        //    Pull input from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        //    Push output to user
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        // 9. Emit event
        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    /// @notice Returns the expected output amount for a given input without modifying state.
    /// @param tokenIn Address of the input token
    /// @param amountIn Amount of input tokens
    /// @return amountOut Expected output amount (subject to round‑up fee)
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (tokenIn != address(tokenA) && tokenIn != address(tokenB)) revert InvalidInput();
        if (amountIn == 0) revert InvalidInput();

        (uint256 reserveIn, uint256 reserveOut) = (tokenIn == address(tokenA))
            ? (reserveA, reserveB)
            : (reserveB, reserveA);

        uint256 feeAmount = (amountIn * fee + 10000 - 1) / 10000;
        uint256 amountInAfterFee = amountIn - feeAmount;

        if (amountInAfterFee == 0) return 0;

        amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
    }
}
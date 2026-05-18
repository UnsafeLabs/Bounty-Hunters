// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleSwap
 * @notice Constant product automated market maker with slippage protection,
 *         deadlines, safe fee rounding up, and reentrancy protection.
 * @dev Uses OpenZeppelin's `SafeERC20`, `Math`, and `ReentrancyGuard`.
 */
contract SimpleSwap is ReentrancyGuard {
    using Math for uint256;
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    // Custom Errors (gas-efficient, no string storage)
    // ──────────────────────────────────────────────

    /// @dev Thrown when an invalid token address is provided.
    error InvalidToken();

    /// @dev Thrown when amount is zero.
    error ZeroAmount();

    /// @dev Thrown when the actual output is below the user's minimum expected.
    error SlippageExceeded(uint256 actual, uint256 minExpected);

    /// @dev Thrown when the transaction's deadline has passed.
    error TransactionExpired(uint256 currentTimestamp, uint256 deadline);

    /// @dev Thrown when there is insufficient liquidity for the swap.
    error InsufficientLiquidity();

    /// @dev Thrown when the fee exceeds allowed limit.
    error FeeTooHigh();

    /// @dev Thrown when amount after fee deduction is zero.
    error AmountTooSmall();

    // ──────────────────────────────────────────────
    // State Variables
    // ──────────────────────────────────────────────

    /// @notice Address of token A.
    IERC20 public immutable tokenA;

    /// @notice Address of token B.
    IERC20 public immutable tokenB;

    /// @notice Reserve of token A.
    uint256 public reserveA;

    /// @notice Reserve of token B.
    uint256 public reserveB;

    /// @notice Fee in basis points (e.g., 30 = 0.3%).
    uint256 public immutable fee;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────

    /// @notice Emitted when tokens are swapped.
    /// @param user Initiator of the swap.
    /// @param tokenIn Address of the input token.
    /// @param amountIn Amount of input tokens.
    /// @param amountOut Amount of output tokens received.
    event Swap(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut
    );

    /// @notice Emitted when liquidity is added.
    /// @param provider Address providing liquidity.
    /// @param amountA Amount of token A deposited.
    /// @param amountB Amount of token B deposited.
    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB
    );

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────

    /**
     * @notice Initializes the swap contract with two tokens and a fee.
     * @param _tokenA Address of the first token (non-zero, not equal to _tokenB).
     * @param _tokenB Address of the second token (non-zero, not equal to _tokenA).
     * @param _fee Fee in basis points (must be < 10000).
     */
    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _fee
    ) {
        if (_tokenA == address(0) || _tokenB == address(0)) revert InvalidToken();
        if (_tokenA == _tokenB) revert InvalidToken();
        if (_fee >= 10_000) revert FeeTooHigh();

        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        fee = _fee;
    }

    // ──────────────────────────────────────────────
    // Liquidity Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Adds liquidity to the pool by depositing both tokens proportionally.
     * @dev Transfers tokens from the sender using `SafeERC20`; amounts must both be > 0.
     *      Reentrancy guard prevents reentrant calls.
     * @param amountA Amount of token A to deposit.
     * @param amountB Amount of token B to deposit.
     */
    function addLiquidity(
        uint256 amountA,
        uint256 amountB
    ) external nonReentrant {
        if (amountA == 0 || amountB == 0) revert ZeroAmount();

        // Transfer tokens from caller using SafeERC20 (handles non-standard ERC20)
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        // Update reserves (underflow impossible, overflow checked by Solidity 0.8+)
        reserveA += amountA;
        reserveB += amountB;

        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    // ──────────────────────────────────────────────
    // Swap Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Executes a swap between token A and token B.
     * @dev Uses constant product formula `x * y = k` with fee deducted from input.
     *      Fee is rounded up to prevent zero fee on small amounts.
     *      Includes deadline and slippage protection.
     *      Uses reentrancy guard to protect against reentrant token callbacks.
     * @param tokenIn Address of the token being swapped in (must be tokenA or tokenB).
     * @param amountIn Amount of input tokens (must be > 0, must leave positive amount after fee).
     * @param minAmountOut Minimum acceptable output amount (reverts if less).
     * @param deadline Unix timestamp after which the transaction reverts.
     * @return amountOut The actual amount of output tokens transferred to sender.
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        // ── Timestamp deadline check ──
        if (block.timestamp > deadline)
            revert TransactionExpired(block.timestamp, deadline);

        // ── Input validation ──
        if (tokenIn != address(tokenA) && tokenIn != address(tokenB))
            revert InvalidToken();
        if (amountIn == 0) revert ZeroAmount();

        bool isTokenA = tokenIn == address(tokenA);

        // Cache reserves before any state changes
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        if (reserveOut == 0) revert InsufficientLiquidity();

        // ── Transfer input tokens from user using SafeERC20 ──
        IERC20 inputToken = isTokenA ? tokenA : tokenB;
        IERC20 outputToken = isTokenA ? tokenB : tokenA;

        inputToken.safeTransferFrom(msg.sender, address(this), amountIn);

        // ── Fee calculation (rounded up to avoid zero fee on small amounts) ──
        // feeAmount = ceil(amountIn * fee / 10000)
        // Using formula (a * b + denominator - 1) / denominator
        uint256 feeAmount = (amountIn * fee + 9_999) / 10_000;
        if (feeAmount >= amountIn) revert AmountTooSmall();
        uint256 amountInAfterFee = amountIn - feeAmount;

        // ── Constant product formula ──
        // amountOut = floor((reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee))
        amountOut = reserveOut.mulDiv(
            amountInAfterFee,
            reserveIn + amountInAfterFee
        );

        // ── Slippage protection ──
        if (amountOut < minAmountOut)
            revert SlippageExceeded(amountOut, minAmountOut);

        // ── Update reserves (effects before external calls) ──
        if (isTokenA) {
            reserveA = reserveIn + amountIn;
            reserveB = reserveOut - amountOut;
        } else {
            reserveB = reserveIn + amountIn;
            reserveA = reserveOut - amountOut;
        }

        // ── Transfer output tokens to user using SafeERC20 ──
        outputToken.safeTransfer(msg.sender, amountOut);

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    // ──────────────────────────────────────────────
    // View Functions
    // ──────────────────────────────────────────────

    /**
     * @notice Calculates the expected output amount for a given input (without state changes).
     * @dev Uses the same constant product formula with fee rounding as `swap`.
     *      Does NOT include slippage check – purely informational.
     * @param tokenIn Address of the input token.
     * @param amountIn Amount of input tokens.
     * @return amountOut Expected output amount.
     */
    function getAmountOut(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        if (tokenIn != address(tokenA) && tokenIn != address(tokenB))
            revert InvalidToken();
        if (amountIn == 0) return 0;

        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        if (reserveOut == 0) return 0;

        // Fee rounding (same as swap)
        uint256 feeAmount = (amountIn * fee + 9_999) / 10_000;
        if (feeAmount >= amountIn) return 0;
        uint256 amountInAfterFee = amountIn - feeAmount;

        amountOut = reserveOut.mulDiv(
            amountInAfterFee,
            reserveIn + amountInAfterFee
        );
    }

    /**
     * @notice Returns the current reserves of both tokens.
     * @return reserveA Current reserve of token A.
     * @return reserveB Current reserve of token B.
     */
    function getReserves() external view returns (uint256, uint256) {
        return (reserveA, reserveB);
    }
}
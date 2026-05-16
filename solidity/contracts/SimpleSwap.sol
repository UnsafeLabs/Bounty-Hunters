solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title SimpleSwap – A minimal token swap contract with slippage and deadline protection.
/// @notice Users can swap a fixed amount of tokenIn for tokenOut at a predefined rate,
///         subject to a fee and a minimum output amount. Fee is calculated with rounding up
///         to avoid precision loss for small amounts.
/// @dev All arithmetic is integer‑safe due to Solidity 0.8+. Uses OpenZeppelin's SafeERC20, Math, and ReentrancyGuard.
contract SimpleSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    //  Constants
    // -----------------------------------------------------------------------

    /// @notice Basis points denominator (100% = 10_000 bps).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Rate denominator (18 decimal places for fixed-point rate).
    uint256 public constant RATE_DENOMINATOR = 1e18;

    // -----------------------------------------------------------------------
    //  Errors
    // -----------------------------------------------------------------------

    /// @dev Revert if an address is zero.
    error InvalidAddress();

    /// @dev Revert if rate is zero.
    error InvalidRate();

    /// @dev Revert if fee exceeds 100%.
    error InvalidFee(uint256 fee);

    /// @dev Revert if amountIn is zero.
    error AmountInZero();

    /// @dev Revert if amount after fee is zero (fee consumes all input).
    error AmountAfterFeeZero();

    /// @dev Revert if the transaction has expired.
    error SwapExpired(uint256 deadline, uint256 blockTimestamp);

    /// @dev Revert if amountOut is less than minAmountOut.
    error SlippageExceeded(uint256 amountOut, uint256 minAmountOut);

    // -----------------------------------------------------------------------
    //  State Variables (immutable)
    // -----------------------------------------------------------------------

    /// @notice Address of the token sent by the user.
    address public immutable tokenIn;

    /// @notice Address of the token received by the user.
    address public immutable tokenOut;

    /// @notice Conversion rate: amount of tokenOut (wei) per 1e18 wei of tokenIn (after fee).
    uint256 public immutable rate;

    /// @notice Fee in basis points (1 bp = 0.01%). Must be ≤ 10_000.
    uint256 public immutable fee;

    // -----------------------------------------------------------------------
    //  Events
    // -----------------------------------------------------------------------

    /// @notice Emitted when a swap is successfully executed.
    /// @param user       Address that performed the swap.
    /// @param amountIn   Gross amount of tokenIn transferred (including fee).
    /// @param amountOut  Net amount of tokenOut received.
    /// @param feeCharged Fee deducted from input (rounded up).
    event Swapped(
        address indexed user,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeCharged
    );

    // -----------------------------------------------------------------------
    //  Constructor
    // -----------------------------------------------------------------------

    /// @notice Initializes the contract with token addresses, rate, and fee.
    /// @param tokenIn_  Address of input token (must be non‑zero).
    /// @param tokenOut_ Address of output token (must be non‑zero and different from tokenIn_).
    /// @param rate_     Conversion rate (wei per wei, 18 decimals; must be > 0).
    /// @param fee_      Fee in basis points (must be ≤ 10_000).
    constructor(
        address tokenIn_,
        address tokenOut_,
        uint256 rate_,
        uint256 fee_
    ) {
        if (tokenIn_ == address(0) || tokenOut_ == address(0)) {
            revert InvalidAddress();
        }
        if (tokenIn_ == tokenOut_) {
            revert InvalidAddress();
        }
        if (rate_ == 0) {
            revert InvalidRate();
        }
        if (fee_ > BPS_DENOMINATOR) {
            revert InvalidFee(fee_);
        }

        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
        rate = rate_;
        fee = fee_;
    }

    // -----------------------------------------------------------------------
    //  Modifiers
    // -----------------------------------------------------------------------

    /// @notice Reverts if the transaction timestamp exceeds the given deadline.
    /// @param deadline Unix timestamp after which the transaction is invalid.
    modifier onlyBeforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) {
            revert SwapExpired(deadline, block.timestamp);
        }
        _;
    }

    // -----------------------------------------------------------------------
    //  Internal Helper
    // -----------------------------------------------------------------------

    /// @notice Calculates the fee amount rounded up.
    /// @param amountIn Gross input amount.
    /// @return feeAmount Fee in tokenIn wei (rounded up).
    /// @dev Uses mulDiv with rounding up: (amountIn * fee + BPS_DENOMINATOR - 1) / BPS_DENOMINATOR.
    function _calculateFee(uint256 amountIn) internal view returns (uint256 feeAmount) {
        // Ceiling division to avoid precision loss for small amounts.
        feeAmount = Math.mulDiv(amountIn, fee, BPS_DENOMINATOR, Math.Rounding.Up);
    }

    // -----------------------------------------------------------------------
    //  External View Functions
    // -----------------------------------------------------------------------

    /// @notice Preview the output amount for a given input before swapping.
    /// @param amountIn Gross input amount (including fee).
    /// @return amountOut Expected output amount after fee and rate.
    /// @return feeCharged Fee deducted (rounded up).
    /// @dev Reverts with {AmountInZero} if `amountIn` is zero to maintain consistency with the {swap} function.
    function previewSwap(uint256 amountIn) external view returns (uint256 amountOut, uint256 feeCharged) {
        if (amountIn == 0) {
            revert AmountInZero();
        }
        feeCharged = _calculateFee(amountIn);
        uint256 amountAfterFee = amountIn - feeCharged;
        if (amountAfterFee == 0) {
            revert AmountAfterFeeZero();
        }
        // Standard rounding down for output (conservative for user, safe for contract).
        amountOut = Math.mulDiv(amountAfterFee, rate, RATE_DENOMINATOR);
    }

    /// @notice Returns the fee amount that would be charged for a given input.
    /// @param amountIn Gross input amount.
    /// @return feeAmount Fee in tokenIn wei (rounded up).
    function getFeeAmount(uint256 amountIn) external view returns (uint256 feeAmount) {
        return _calculateFee(amountIn);
    }

    // -----------------------------------------------------------------------
    //  External Swap Function
    // -----------------------------------------------------------------------

    /// @notice Swaps `amountIn` of tokenIn for tokenOut.
    /// @param amountIn     Gross amount of tokenIn to send from caller.
    /// @param minAmountOut Minimum acceptable output amount (slippage protection).
    /// @param deadline     Unix timestamp after which the transaction reverts.
    /// @dev Reverts if deadline is past, input is zero, fee consumes all input,
    ///      output is below minimum, or transfers fail.
    ///      Uses {ReentrancyGuard} to prevent reentrancy and follows checks‑effects‑interactions pattern.
    function swap(
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant onlyBeforeDeadline(deadline) {
        // ---- Input validation ----
        if (amountIn == 0) {
            revert AmountInZero();
        }

        // ---- Fee calculation (rounded up to avoid precision loss) ----
        uint256 feeCharged = _calculateFee(amountIn);
        uint256 amountAfterFee = amountIn - feeCharged;
        if (amountAfterFee == 0) {
            revert AmountAfterFeeZero();
        }

        // ---- Output calculation (exact fixed‑point, rounded down) ----
        uint256 amountOut = Math.mulDiv(amountAfterFee, rate, RATE_DENOMINATOR);

        // ---- Slippage check ----
        if (amountOut < minAmountOut) {
            revert SlippageExceeded(amountOut, minAmountOut);
        }

        // ---- Effects: emit event before external calls ----
        emit Swapped(msg.sender, amountIn, amountOut, feeCharged);

        // ---- Interactions: token transfers (SafeERC20) ----
        // Transfer tokenIn from user to this contract.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        // Transfer tokenOut from this contract to user.
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}
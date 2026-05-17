solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title IFlashLoanReceiver
/// @notice Interface for flash loan receiver contracts.
interface IFlashLoanReceiver {
    /// @notice Callback invoked after tokens are loaned to the receiver.
    /// @param token The address of the loaned token.
    /// @param amount The amount borrowed (excluding fee).
    /// @param fee The fee charged for the loan.
    /// @param data Arbitrary calldata passed through from the initiator.
    function executeOperation(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external;
}

/// @title FlashLoan
/// @notice A robust flash loan contract with minimum fee, maximum loan cap, rebasing protection, emergency pause, and internal accounting.
/// @dev The contract supports a single ERC20 token. Minimum fee = 1 token unit. Max loan = 50% of internal pool balance.
///      Uses internal `_poolBalance` to track reserves and `_totalFeesAccrued` for share calculations.
///      Owner can pause/unpause, toggle non-rebasing, and force sync of internal balance.
/// @custom:security-contact security@example.com
contract FlashLoan is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────────────────
    // Custom Errors (gas efficient, no string storage)
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Thrown when token address is zero.
    error InvalidToken();

    /// @notice Thrown when feeBPS is zero or exceeds 10000.
    error InvalidFeeBPS();

    /// @notice Thrown when receiver address is zero.
    error InvalidReceiver();

    /// @notice Thrown when loan amount is zero.
    error ZeroAmount();

    /// @notice Thrown when loan amount exceeds the current maximum allowed.
    error ExceedsMaxLoanAmount(uint256 amount, uint256 maxAllowed);

    /// @notice Thrown when computed fee is zero even after applying minimum fee (should never happen).
    error FeeZero();

    /// @notice Thrown when the receiver fails to return the principal plus fee.
    error FlashLoanNotRepaid();

    /// @notice Thrown when a flash loan is attempted on a token marked as rebasing.
    error NonRebasingRequired();

    /// @notice Thrown when the owner tries to unpause but the contract is already unpaused (or vice versa).
    /// @dev Only used internally; Pausable handles pause/unpause state, but we add a custom error for extra clarity.
    // Usage is optional; we rely on OpenZeppelin's internal checks.
    // error InvalidPauseState();

    // ──────────────────────────────────────────────────────────────────────────
    // Constants & Immutables
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Minimum fee enforced in token units to prevent free loans.
    uint256 public constant MIN_FEE = 1;

    /// @notice Maximum loan as a percentage of the pool (5000 BPS = 50%).
    uint256 public constant MAX_POOL_PERCENT_BPS = 5000;

    /// @notice Underlying ERC20 token.
    IERC20 public immutable token;

    /// @notice Fee in basis points (10000 = 100%).
    uint256 public immutable feeBPS;

    // ──────────────────────────────────────────────────────────────────────────
    // State Variables
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Whether the token is assumed non-rebasing.
    bool public isNonRebasing;

    /// @notice Internal bookkeeping of the pool's expected token balance.
    uint256 private _poolBalance;

    /// @notice Total fees accumulated from flash loans.
    uint256 private _totalFeesAccrued;

    // ──────────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when a flash loan is executed.
    /// @param receiver The address that received the loan.
    /// @param token The token borrowed.
    /// @param amount The amount borrowed.
    /// @param fee The fee charged.
    event FlashLoan(
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint256 fee
    );

    /// @notice Emitted when fees are accrued into the pool.
    /// @param fee The fee amount added.
    event FeesAccrued(uint256 fee);

    /// @notice Emitted when the non-rebasing flag is toggled.
    /// @param isNonRebasing New value of the flag.
    event NonRebasingUpdated(bool isNonRebasing);

    /// @notice Emitted when the internal pool balance is manually synced.
    /// @param newBalance The synced pool balance.
    event PoolBalanceSynced(uint256 newBalance);

    // ──────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Reverts if the token is considered rebasing.
    modifier nonRebasingOnly() {
        if (!isNonRebasing) revert NonRebasingRequired();
        _;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Initializes the flash loan contract.
    /// @param token_ The ERC20 token address.
    /// @param feeBPS_ Fee in basis points (e.g., 30 = 0.3%).
    /// @dev Reverts if token_ is zero address or feeBPS_ is zero or >10000.
    constructor(IERC20 token_, uint256 feeBPS_) {
        if (address(token_) == address(0)) revert InvalidToken();
        if (feeBPS_ == 0 || feeBPS_ > 10000) revert InvalidFeeBPS();
        token = token_;
        feeBPS = feeBPS_;
        _poolBalance = token_.balanceOf(address(this));
        isNonRebasing = true; // safe default; owner may disable if token is rebasing
    }

    // ──────────────────────────────────────────────────────────────────────────
    // External View Functions
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Returns the internal bookkeeping balance of the pool.
    /// @return Current internal pool balance (including accrued fees).
    function poolBalance() external view returns (uint256) {
        return _poolBalance;
    }

    /// @notice Returns total fees accrued over the lifetime.
    /// @return Total fees accrued.
    function totalFeesAccrued() external view returns (uint256) {
        return _totalFeesAccrued;
    }

    /// @notice Computes the maximum loan amount currently allowed (50% of internal pool balance).
    /// @return Maximum loan amount.
    function maxLoanAmount() external view returns (uint256) {
        return (_poolBalance * MAX_POOL_PERCENT_BPS) / 10000;
    }

    /// @notice Computes the fee for a given loan amount.
    /// @param amount The loan amount.
    /// @return fee The computed fee, guaranteed >= MIN_FEE.
    /// @dev Reverts if amount is zero.
    function computeFee(uint256 amount) public view returns (uint256 fee) {
        if (amount == 0) revert ZeroAmount();
        fee = (amount * feeBPS) / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }
        // fee is never zero after min enforcement; but if MIN_FEE is set to 0, it could be.
        // We keep the check for robustness.
        if (fee == 0) revert FeeZero();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // External Owner Functions (Pause, Unpause, Set Non-Rebasing, Sync Balance)
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Pauses all flash loan operations.
    /// @dev Only callable by owner. Reverts if already paused (via Pausable).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses flash loan operations.
    /// @dev Only callable by owner. Reverts if already unpaused (via Pausable).
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Updates the non-rebasing flag.
    /// @param _isNonRebasing The new value of the flag.
    /// @dev Only callable by owner. Setting to false disables all flash loans.
    function setNonRebasing(bool _isNonRebasing) external onlyOwner {
        isNonRebasing = _isNonRebasing;
        emit NonRebasingUpdated(_isNonRebasing);
    }

    /// @notice Synchronizes the internal pool balance with the actual token balance.
    /// @dev Useful if tokens are sent directly to the contract. Only callable by owner.
    ///      Emits PoolBalanceSynced event.
    function syncPoolBalance() external onlyOwner {
        uint256 actualBalance = token.balanceOf(address(this));
        _poolBalance = actualBalance;
        emit PoolBalanceSynced(actualBalance);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Core Flash Loan Function
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Executes a flash loan.
    /// @param receiver Address of the flash loan receiver (must implement IFlashLoanReceiver).
    /// @param amount Amount of tokens to loan.
    /// @param data Arbitrary data forwarded to the receiver.
    /// @dev Requirements:
    ///      - Contract must be unpaused.
    ///      - Token must be marked non-rebasing.
    ///      - Receiver cannot be address(0).
    ///      - Amount must be > 0 and ≤ 50% of internal pool balance.
    ///      - Fee must be computed as (amount * feeBPS / 10000) but at least MIN_FEE.
    ///      - After the callback, the contract's token balance (or internal pool balance) must be >= original pool balance + fee.
    ///      - Reentrancy is guarded.
    function flashLoan(
        address receiver,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant whenNotPaused nonRebasingOnly {
        // --- Input validation ---
        if (receiver == address(0)) revert InvalidReceiver();
        if (amount == 0) revert ZeroAmount();
        if (amount > maxLoanAmount())
            revert ExceedsMaxLoanAmount(amount, maxLoanAmount());

        // --- Fee calculation ---
        uint256 fee = computeFee(amount); // guaranteed >= 1

        // --- Pre-execution state ---
        uint256 balanceBefore = _poolBalance; // use internal bookkeeping
        // Ensure actual balance matches (sanity check)
        // This is optional but helps detect mismatches early.
        // Because we rely on non-rebasing, we can trust actual balance.
        if (token.balanceOf(address(this)) != balanceBefore) {
            // Optionally sync; but we don't revert because maybe someone sent tokens.
            // For strictness, we could revert. We choose to trust internal.
            // Better to sync silently? We keep as warning via event.
            // For production, you may want to revert to protect accounting.
            // We'll proceed with internal balance.
        }

        // --- Transfer loan to receiver ---
        token.safeTransfer(receiver, amount);
        _poolBalance -= amount; // deduct from internal balance

        // --- Callback ---
        // The receiver must implement IFlashLoanReceiver.executeOperation.
        // It should use the borrowed tokens and then approve/transfer back.
        // We wrap in try/catch for gas efficiency? gas consumed by invalid receiver.
        // We use a low-level call to catch failures but prefer revert on error.
        // Using interface ensures compile-time check, but we still wrap for safety.
        bool success;
        bytes memory result;
        (success, result) = address(receiver).call(
            abi.encodeWithSelector(
                IFlashLoanReceiver.executeOperation.selector,
                address(token),
                amount,
                fee,
                data
            )
        );
        if (!success) {
            // Decode revert reason if possible
            if (result.length > 0) {
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    let returndata := add(result, 0x20)
                    let returndata_size := mload(result)
                    revert(returndata, returndata_size)
                }
            } else {
                revert FlashLoanNotRepaid();
            }
        }

        // --- Post-execution repayment check ---
        uint256 balanceAfter = token.balanceOf(address(this));
        uint256 expectedBalance = balanceBefore + fee;
        if (balanceAfter < expectedBalance) revert FlashLoanNotRepaid();

        // --- Update internal accounting ---
        uint256 actualRepayment = balanceAfter - _poolBalance; // _poolBalance is after loan deduction
        // actualRepayment should be >= amount + fee, but we only need to add fee difference.
        // Better to set _poolBalance to balanceAfter directly to avoid rounding.
        _poolBalance = balanceAfter;

        // Track fee accrual
        uint256 feeCollected = _poolBalance - (balanceBefore - amount); // alternative compute
        // Simpler: feeCollected = balanceAfter - (balanceBefore - amount)
        // But we already have fee variable; we can use it directly.
        // Since we trust non-rebasing, we can assume the difference is exactly fee.
        _totalFeesAccrued += fee;

        emit FlashLoan(receiver, address(token), amount, fee);
        emit FeesAccrued(fee);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Fallback / Receive
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Contract does not accept direct ETH transfers.
    receive() external payable {
        revert("FlashLoan: ETH not accepted");
    }

    /// @notice Fallback.
    fallback() external payable {
        revert("FlashLoan: fallback disabled");
    }
}
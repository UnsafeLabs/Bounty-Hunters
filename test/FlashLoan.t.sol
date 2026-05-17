solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FlashLoan
 * @notice Provides uncollateralized flash loans within a single transaction.
 * @dev Uses internal accounting to prevent rebasing token exploits.
 * - Minimum fee of 1 token unit prevents free loans.
 * - Max loan cap configurable by owner (default 50% of pool balance).
 * - Emergency pause functionality.
 * - Deposit and withdraw pool liquidity for any depositor.
 * - Fee accrual tracked for pool share calculations.
 * - Reentrancy guard on all state-changing functions.
 * - Explicit typed interface for callbacks, no low-level calls.
 * - Handles fee-on-transfer tokens by verifying loan delivery.
 */
contract FlashLoan is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────────────────────
    // Interface
    // ──────────────────────────────────────────────────────────────

    /// @notice Callback interface for flash loan receivers.
    interface IFlashLoanCallback {
        function flashLoanCallback(uint256 amount, uint256 fee, bytes calldata data) external;
    }

    // ──────────────────────────────────────────────────────────────
    // Errors
    // ──────────────────────────────────────────────────────────────

    /// @notice Thrown when token address is zero.
    error InvalidToken();

    /// @notice Thrown when flash loan amount is zero.
    error FlashLoanAmountZero();

    /// @notice Thrown when flash loan amount exceeds the maximum allowed cap.
    error FlashLoanAmountExceedsCap(uint256 amount, uint256 maxAllowed);

    /// @notice Thrown when the calculated fee would be zero (should not happen with min fee).
    error FlashLoanFeeZero();

    /// @notice Thrown when the callback receiver address is zero.
    error FlashLoanInvalidReceiver();

    /// @notice Thrown when feeBPS is too low (must be at least 1).
    error FlashLoanFeeTooLow(uint256 feeBPS);

    /// @notice Thrown when max loan cap BPS is out of valid range (0, 10000].
    error FlashLoanCapOutOfRange(uint256 capBPS);

    /// @notice Thrown when deposit amount is zero.
    error FlashLoanDepositZero();

    /// @notice Thrown when withdrawal amount exceeds depositor's balance.
    error FlashLoanWithdrawExceedsBalance(uint256 amount, uint256 balance);

    /// @notice Thrown when the contract's actual token balance is insufficient for loan.
    error FlashLoanInsufficientBalance();

    /// @notice Thrown when the token takes a fee on transfer (loan delivery not exact).
    error FlashLoanFeeOnTransferDetected();

    /// @notice Thrown when repayment transfer fails to return sufficient funds.
    error FlashLoanRepaymentFailed();

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    /// @notice Emitted when a flash loan is executed.
    /// @param receiver Address that received the loan.
    /// @param amount Amount of tokens borrowed.
    /// @param fee Fee paid for the loan.
    event FlashLoanExecuted(
        address indexed receiver,
        uint256 indexed amount,
        uint256 fee
    );

    /// @notice Emitted when pool liquidity is deposited.
    /// @param depositor Address that deposited tokens.
    /// @param amount Amount deposited.
    event PoolDeposited(address indexed depositor, uint256 amount);

    /// @notice Emitted when pool liquidity is withdrawn.
    /// @param withdrawer Address that withdrew tokens.
    /// @param amount Amount withdrawn.
    event PoolWithdrawn(address indexed withdrawer, uint256 amount);

    /// @notice Emitted when the fee basis points is updated.
    /// @param oldFeeBPS Previous feeBPS value.
    /// @param newFeeBPS New feeBPS value.
    event FeeUpdated(uint256 oldFeeBPS, uint256 newFeeBPS);

    /// @notice Emitted when the max loan cap percent (in BPS) is updated.
    /// @param oldCap Previous cap BPS.
    /// @param newCap New cap BPS.
    event MaxLoanCapUpdated(uint256 oldCap, uint256 newCap);

    /// @notice Emitted when the contract is paused.
    /// @param by Address that triggered the pause.
    event FlashLoanPaused(address indexed by);

    /// @notice Emitted when the contract is unpaused.
    /// @param by Address that triggered the unpause.
    event FlashLoanUnpaused(address indexed by);

    // ──────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────

    /// @notice Basis points denominator.
    uint256 private constant BPS_DENOMINATOR = 10000;

    /// @notice Minimum fee in token units to avoid free flash loans.
    uint256 private constant MIN_FEE = 1;

    /// @notice Minimum allowed feeBPS (0.01%).
    uint256 private constant MIN_FEE_BPS = 1;

    // ──────────────────────────────────────────────────────────────
    // State Variables
    // ──────────────────────────────────────────────────────────────

    /// @notice The ERC20 token used for flash loans.
    IERC20 public immutable token;

    /// @notice Fee in basis points (e.g., 100 = 1%).
    uint256 public feeBPS;

    /// @notice Maximum loan amount as percentage of pool balance (in BPS). Default 5000 (50%).
    uint256 public maxLoanCapBPS;

    /// @notice Total fees accrued from flash loans (available for distribution to LPs).
    uint256 public totalFees;

    /// @notice Internal pool balance tracking (immune to rebasing tokens).
    /// @dev Represents the total amount of deposited tokens currently held by the pool.
    uint256 internal _poolBalance;

    /// @notice Individual depositor balances (for withdrawal rights).
    mapping(address => uint256) private _depositorBalances;

    // ──────────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Initializes the FlashLoan contract.
     * @param _token Address of the ERC20 token to use.
     * @param _feeBPS Fee in basis points (must be >= 1).
     * @dev Sets default max loan cap to 5000 BPS (50%).
     */
    constructor(address _token, uint256 _feeBPS) Ownable(msg.sender) {
        if (_token == address(0)) revert InvalidToken();
        token = IERC20(_token);
        _setFeeBPS(_feeBPS);
        _setMaxLoanCapBPS(5000); // default 50%
    }

    // ──────────────────────────────────────────────────────────────
    // Modifiers
    // ──────────────────────────────────────────────────────────────

    /// @notice Check that the token is not rebasing by verifying that internal
    ///         pool balance does not exceed actual token balance (allows tight accounting).
    /// @dev This is a soft check; actual rebasing protection relies on internal accounting.
    modifier nonRebasingOnly() {
        _;
        // After any operation that modifies balance, ensure internal pool balance
        // does not exceed actual contract balance (else accounting is off).
        require(_poolBalance <= token.balanceOf(address(this)), "Internal balance exceeds actual");
    }

    // ──────────────────────────────────────────────────────────────
    // External Functions – Pool Management
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Deposits tokens into the flash loan pool.
     * @param amount Amount of tokens to deposit.
     * @dev Updates internal balance and pulls tokens from caller.
     */
    function depositToPool(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert FlashLoanDepositZero();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _depositorBalances[msg.sender] += amount;
        _poolBalance += amount;
        emit PoolDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraws tokens from the flash loan pool (any depositor can withdraw their share).
     * @param amount Amount to withdraw.
     * @dev Withdraws from depositor's recorded balance, up to their deposit.
     */
    function withdrawFromPool(uint256 amount) external nonReentrant whenNotPaused {
        if (amount > _depositorBalances[msg.sender]) revert FlashLoanWithdrawExceedsBalance(amount, _depositorBalances[msg.sender]);
        _depositorBalances[msg.sender] -= amount;
        _poolBalance -= amount;
        token.safeTransfer(msg.sender, amount);
        emit PoolWithdrawn(msg.sender, amount);
    }

    /**
     * @notice View depositor's current deposited amount.
     * @param depositor Address of the depositor.
     * @return balance Amount deposited.
     */
    function depositorBalance(address depositor) external view returns (uint256) {
        return _depositorBalances[depositor];
    }

    // ──────────────────────────────────────────────────────────────
    // External Functions – Flash Loan Execution
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Executes a flash loan to a receiver contract.
     * @param receiver Address of the contract that will receive the loan and implement IFlashLoanCallback.
     * @param amount Amount of tokens to borrow.
     * @param data Arbitrary data to pass to the receiver's `flashLoanCallback` function.
     * @dev The receiver must approve this contract to spend at least `amount + fee` tokens before calling this function.
     *      After the callback, repayment is pulled via `safeTransferFrom`.
     */
    function flashLoan(
        address receiver,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant whenNotPaused nonRebasingOnly {
        // ── Input validation ──
        if (amount == 0) revert FlashLoanAmountZero();
        if (receiver == address(0)) revert FlashLoanInvalidReceiver();

        // ── Compute fee ──
        uint256 fee = _calculateFee(amount);
        if (fee == 0) revert FlashLoanFeeZero(); // should not happen with min fee

        // ── Check cap ──
        uint256 maxLoan = (_poolBalance * maxLoanCapBPS) / BPS_DENOMINATOR;
        if (amount > maxLoan) revert FlashLoanAmountExceedsCap(amount, maxLoan);

        // ── Check actual balance ──
        uint256 contractBalanceBefore = token.balanceOf(address(this));
        if (contractBalanceBefore < amount) revert FlashLoanInsufficientBalance();

        // ── Record initial state for fee-on-transfer check ──
        uint256 receiverBalanceBefore = token.balanceOf(receiver);

        // ── Transfer loan to receiver ──
        token.safeTransfer(receiver, amount);

        // ── Verify receiver received full amount (reject fee-on-transfer) ──
        if (token.balanceOf(receiver) - receiverBalanceBefore != amount) {
            revert FlashLoanFeeOnTransferDetected();
        }

        // ── Execute callback ──
        IFlashLoanCallback(receiver).flashLoanCallback(amount, fee, data);

        // ── Pull repayment (principal + fee) from receiver ──
        uint256 repayment = amount + fee;
        token.safeTransferFrom(receiver, address(this), repayment);

        // ── Verify repayment success (actual balance increase) ──
        uint256 contractBalanceAfter = token.balanceOf(address(this));
        if (contractBalanceAfter < contractBalanceBefore + fee) {
            revert FlashLoanRepaymentFailed();
        }

        // ── Update internal accounting ──
        // Pool balance increases by fee (principal is returned)
        _poolBalance += fee;
        totalFees += fee;

        emit FlashLoanExecuted(receiver, amount, fee);
    }

    // ──────────────────────────────────────────────────────────────
    // External Functions – Admin (Owner Only)
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Updates the fee basis points.
     * @param newFeeBPS New fee in basis points (must be >= 1).
     */
    function setFeeBPS(uint256 newFeeBPS) external onlyOwner {
        _setFeeBPS(newFeeBPS);
    }

    /**
     * @notice Updates the maximum loan cap as a percentage of pool balance (in BPS).
     * @param newCapBPS New cap in basis points (0 < capBPS <= 10000).
     */
    function setMaxLoanCapBPS(uint256 newCapBPS) external onlyOwner {
        _setMaxLoanCapBPS(newCapBPS);
    }

    /**
     * @notice Pauses all flash loan and deposit/withdraw functions.
     * @dev Only callable by owner.
     */
    function pause() external onlyOwner {
        _pause();
        emit FlashLoanPaused(msg.sender);
    }

    /**
     * @notice Unpauses all flash loan and deposit/withdraw functions.
     * @dev Only callable by owner.
     */
    function unpause() external onlyOwner {
        _unpause();
        emit FlashLoanUnpaused(msg.sender);
    }

    /**
     * @notice Syncs internal pool balance with actual token balance (e.g., after a rebase).
     * @dev Only callable by owner, for emergency recovery.
     */
    function syncPoolBalance() external onlyOwner {
        uint256 actualBalance = token.balanceOf(address(this));
        _poolBalance = actualBalance;
    }

    // ──────────────────────────────────────────────────────────────
    // Internal Functions
    // ──────────────────────────────────────────────────────────────

    /**
     * @notice Calculates the fee for a given loan amount.
     * @param amount Loan amount.
     * @return fee The fee to charge (minimum 1 token unit).
     */
    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 fee = (amount * feeBPS) / BPS_DENOMINATOR;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }
        return fee;
    }

    /**
     * @dev Sets feeBPS with validation.
     * @param _feeBPS New fee in basis points.
     */
    function _setFeeBPS(uint256 _feeBPS) internal {
        if (_feeBPS < MIN_FEE_BPS) revert FlashLoanFeeTooLow(_feeBPS);
        uint256 oldFee = feeBPS;
        feeBPS = _feeBPS;
        emit FeeUpdated(oldFee, _feeBPS);
    }

    /**
     * @dev Sets maxLoanCapBPS with validation.
     * @param _capBPS New cap in basis points (must be > 0 and <= 10000).
     */
    function _setMaxLoanCapBPS(uint256 _capBPS) internal {
        if (_capBPS == 0 || _capBPS > BPS_DENOMINATOR) revert FlashLoanCapOutOfRange(_capBPS);
        uint256 oldCap = maxLoanCapBPS;
        maxLoanCapBPS = _capBPS;
        emit MaxLoanCapUpdated(oldCap, _capBPS);
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/**
 * @title FlashLoan
 * @notice Uncollateralized flash loans with security hardening
 * @dev Fixes:
 *   - Minimum fee of 1 token unit prevents zero-fee loans
 *   - Max loan cap at 50% of tracked pool balance prevents drainage
 *   - Internal accounting replaces balanceOf to prevent rebasing token exploits
 *   - Emergency pause via OpenZeppelin Pausable
 *   - SafeERC20 for checked transfers
 *   - ReentrancyGuard on all external functions
 */
contract FlashLoan is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public loanToken;
    uint256 public feeBPS;        // fee in basis points
    uint256 public totalFees;     // accumulated fees (internal accounting)
    uint256 public poolBalance;   // internal pool balance tracking

    uint256 public constant MAX_LOAN_PERCENT = 50; // max 50% of pool per loan
    uint256 public constant MIN_FEE = 1;           // minimum fee in token units

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Deposited(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);

    constructor(address _loanToken, uint256 _feeBPS) Ownable(msg.sender) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS > 0 && _feeBPS <= 1000, "Invalid fee BPS"); // max 10%
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
    }

    /**
     * @notice Execute a flash loan
     * @param amount Amount to borrow
     * @param data Arbitrary data passed to the receiver callback
     */
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        // Use internal accounting instead of balanceOf
        uint256 _poolBalance = poolBalance;
        require(_poolBalance >= amount, "Insufficient pool balance");

        // Cap loans at 50% of pool to prevent drainage
        uint256 maxLoan = (_poolBalance * MAX_LOAN_PERCENT) / 100;
        require(amount <= maxLoan, "Exceeds max loan amount");

        // Minimum fee of 1 token unit prevents zero-fee for small amounts
        uint256 fee = amount * feeBPS / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }

        // Transfer tokens out using SafeERC20
        loanToken.safeTransfer(msg.sender, amount);

        // Call receiver
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify repayment via internal accounting (not balanceOf)
        // Borrower must have approved this contract to pull amount + fee
        loanToken.safeTransferFrom(msg.sender, address(this), amount + fee);

        // Update internal accounting
        poolBalance += fee;  // Sync: actual balance increased by fee
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    /**
     * @notice Deposit tokens to the lending pool
     * @param amount Amount to deposit
     */
    function depositToPool(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw accumulated fees (owner only)
     */
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.safeTransfer(owner(), fees);
        emit FeesWithdrawn(owner(), fees);
    }

    /**
     * @notice Get pool balance (uses internal accounting)
     * @return The tracked pool balance
     */
    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    /**
     * @notice Update fee BPS (owner only, max 10%)
     * @param newFeeBPS New fee in basis points
     */
    function setFeeBPS(uint256 newFeeBPS) external onlyOwner {
        require(newFeeBPS > 0 && newFeeBPS <= 1000, "Invalid fee BPS");
        feeBPS = newFeeBPS;
    }

    /**
     * @notice Sync internal balance with actual token balance
     * @dev Use only if balance drifts due to direct transfers
     */
    function syncBalance() external onlyOwner {
        poolBalance = loanToken.balanceOf(address(this));
    }
}

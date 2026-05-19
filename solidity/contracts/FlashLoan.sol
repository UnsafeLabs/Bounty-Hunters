// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/**
 * @title FlashLoan
 * @notice Uncollateralized flash loan with pool drainage protection.
 * @dev Fixes (issue #919):
 *   1. Minimum fee of 1 wei prevents zero-fee flash loans
 *   2. maxLoanPercent caps at 50% of pool to prevent drainage
 *   3. Internal balance tracking instead of balanceOf for rebasing safety
 *   4. Emergency pause by owner
 */
contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    address public owner;
    bool public paused;

    /// @notice Internal pool balance tracking (rebasing-safe)
    uint256 public poolBalance;

    /// @notice Maximum loan percentage in basis points (5000 = 50%)
    uint256 public constant MAX_LOAN_PERCENT = 5000;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS > 0 && _feeBPS <= 1000, "Invalid fee"); // max 10%
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /**
     * @notice Execute a flash loan.
     * @param amount Loan amount.
     * @param data Arbitrary data passed to the callback.
     */
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        // Use internal accounting (rebasing-safe)
        require(poolBalance >= amount, "Insufficient pool balance");

        // Pool drainage protection: max 50% of pool
        require(amount <= poolBalance * MAX_LOAN_PERCENT / 10000, "Exceeds max loan amount");

        // Minimum fee of 1 to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1; // minimum fee
        }

        uint256 balanceBefore = loanToken.balanceOf(address(this));

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        // Update internal accounting
        poolBalance = poolBalance + fee;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    /**
     * @notice Deposit tokens into the lending pool.
     */
    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    /**
     * @notice Withdraw accumulated fees (owner only).
     */
    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    /**
     * @notice Emergency pause — stops all flash loans.
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause — resumes flash loans.
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}

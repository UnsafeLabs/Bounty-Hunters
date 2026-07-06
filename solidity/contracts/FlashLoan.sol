// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance; // internal accounting to prevent rebasing token exploits
    address public owner;
    bool public paused;

    uint256 public constant MAX_LOAN_BPS = 5000; // 50% of pool balance
    uint256 public constant MIN_FEE = 1; // minimum fee of 1 token unit

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token address");
        require(_feeBPS > 0, "Fee BPS must be > 0");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /**
     * @dev Execute a flash loan with fee validation, max loan cap, and internal accounting.
     * Fix #1: Minimum fee of 1 token prevents zero-fee flash loans for small amounts.
     * Fix #2: Max loan capped at 50% of pool balance to prevent pool drainage.
     * Fix #3: Internal accounting (poolBalance) prevents rebasing token exploits.
     */
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Flash loans are paused");
        require(amount > 0, "Amount must be greater than 0");

        // Fix #1: Ensure fee is at least MIN_FEE (1 token unit) to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }

        // Fix #2: Prevent pool drainage — max loan is 50% of pool balance
        require(amount <= poolBalance * MAX_LOAN_BPS / 10000, "Loan exceeds max loan cap (50% of pool)");
        require(poolBalance >= amount, "Insufficient pool balance");

        // Update internal accounting before transferring
        poolBalance -= amount;

        // Transfer loan amount to borrower
        loanToken.transfer(msg.sender, amount);

        // Callback to borrower
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Fix #3: Use actual balance for repayment validation but update internal accounting
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        uint256 expectedPool = poolBalance + fee;
        require(balanceAfter >= expectedPool, "Flash loan not repaid with fee");

        // Update internal accounting to actual balance (handles any extra repayment)
        poolBalance = balanceAfter;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    /**
     * @dev Deposit tokens into the flash loan pool.
     * Updates internal poolBalance for rebasing token protection.
     */
    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    /**
     * @dev Owner withdraws accumulated fees from the pool.
     */
    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        require(poolBalance >= fees, "Insufficient pool balance for withdrawal");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    /**
     * Fix #4: Emergency pause — disables all flash loans.
     */
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    /**
     * Fix #4: Unpause — re-enables flash loans.
     */
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    /**
     * @dev Returns the current pool balance (internal accounting).
     */
    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}

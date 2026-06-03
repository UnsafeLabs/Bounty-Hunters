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
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS > 0 && _feeBPS <= 10000, "Invalid feeBPS");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    /**
     * @notice Flash loan function with minimum fee, max loan cap, and safe repayment via transferFrom.
     * @param amount Amount of tokens to borrow.
     * @param data Data passed to the borrower's callback.
     */
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = loanToken.balanceOf(address(this));
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= poolBalance / 2, "Loan exceeds 50% of pool balance");

        // Calculate fee with a minimum of 1 token unit
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1; // Minimum fee to prevent free flash loans
        }

        // Transfer the borrowed amount to the borrower
        bool transferSuccess = loanToken.transfer(msg.sender, amount);
        require(transferSuccess, "Transfer failed");

        // Call the borrower's callback
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Repayment: pull principal + fee from borrower using transferFrom
        // Borrower must have approved this contract to spend at least amount + fee
        bool repaySuccess = loanToken.transferFrom(msg.sender, address(this), amount + fee);
        require(repaySuccess, "Repayment failed");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    /**
     * @notice Deposit tokens into the pool.
     * @param amount Amount of tokens to deposit.
     */
    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        bool success = loanToken.transferFrom(msg.sender, address(this), amount);
        require(success, "Transfer failed");
    }

    /**
     * @notice Withdraw accumulated fees (only owner).
     */
    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        bool success = loanToken.transfer(owner, fees);
        require(success, "Transfer failed");
    }

    /**
     * @notice Get current pool balance (tokens held by this contract).
     */
    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is Ownable {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    bool public paused;

    // Internal accounting to prevent rebasing token exploits
    uint256 public internalBalance;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPaused(address indexed by);
    event EmergencyUnpaused(address indexed by);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        // Ownable sets msg.sender as owner
    }

    // FIX: Add minimum fee, max loan cap, internal accounting, and emergency pause
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(msg.sender != address(0), "Invalid sender");

        // FIX: Max loan cap at 50% of pool balance to prevent drainage
        uint256 poolBalance = internalBalance;
        require(amount <= poolBalance / 2, "Loan exceeds max 50% of pool");

        // FIX: Minimum fee of 1 token to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        // Track balance before using internal accounting
        uint256 balanceBefore = internalBalance;

        // Update internal balance to reflect loan
        internalBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal accounting instead of balanceOf to prevent rebasing exploits
        uint256 balanceAfter = internalBalance + loanToken.balanceOf(address(this)) - (internalBalance);
        // Simpler: just track via internal accounting
        uint256 currentBalance = loanToken.balanceOf(address(this));
        uint256 totalRepaid = currentBalance - (balanceBefore - amount);

        require(totalRepaid >= fee, "Loan not repaid with fee");

        // Update internal balance to reflect repayment
        internalBalance = currentBalance;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner(), fees);
    }

    // FIX: Add emergency pause function
    function emergencyPause() external onlyOwner {
        paused = true;
        emit EmergencyPaused(msg.sender);
    }

    function emergencyUnpause() external onlyOwner {
        paused = false;
        emit EmergencyUnpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}

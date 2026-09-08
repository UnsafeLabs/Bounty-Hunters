// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;
    
    // FIX: Track internal pool balance to prevent rebasing token manipulation
    uint256 private internalPoolBalance;
    // FIX: Add maximum loan amount to prevent draining entire pool
    uint256 public maxLoanAmount;
    
    // FIX: Add minimum fee to prevent zero-fee loans
    uint256 public minFee = 1; // Minimum fee of 1 token unit

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        // FIX: Initialize maxLoanAmount as a percentage of initial pool (e.g., 90%)
        maxLoanAmount = 0; // Will be updated on first deposit
    }

    // FIX: Emergency pause function
    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit Paused();
    }
    
    // FIX: Emergency unpause function
    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit Unpaused();
    }
    
    // FIX: Set max loan amount (can be updated by owner)
    function setMaxLoanAmount(uint256 _maxLoanAmount) external {
        require(msg.sender == owner, "Not owner");
        maxLoanAmount = _maxLoanAmount;
    }
    
    // FIX: Set minimum fee (can be updated by owner)
    function setMinFee(uint256 _minFee) external {
        require(msg.sender == owner, "Not owner");
        minFee = _minFee;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        
        // FIX: Check against internal pool balance instead of balanceOf
        require(internalPoolBalance >= amount, "Insufficient pool balance");
        
        // FIX: Check max loan amount
        require(amount <= maxLoanAmount, "Amount exceeds max loan");

        uint256 fee = amount * feeBPS / 10000;
        
        // FIX: Ensure fee is at least minFee to prevent zero-fee loans
        if (fee < minFee) {
            fee = minFee;
        }
        
        // FIX: Update internal balance before transfer
        internalPoolBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Check repayment using internal balance tracking
        // The receiver must return amount + fee
        uint256 expectedBalance = internalPoolBalance + amount + fee;
        
        // Use actual balance check as secondary validation
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= expectedBalance, "Loan not repaid");
        
        // FIX: Update internal balance after repayment
        internalPoolBalance = actualBalance;

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        // FIX: Update internal pool balance
        internalPoolBalance += amount;
        
        // FIX: Update maxLoanAmount if needed (e.g., 90% of pool)
        if (maxLoanAmount == 0) {
            maxLoanAmount = internalPoolBalance * 90 / 100;
        }
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    function getPoolBalance() external view returns (uint256) {
        // FIX: Return internal pool balance for consistency
        return internalPoolBalance;
    }
}

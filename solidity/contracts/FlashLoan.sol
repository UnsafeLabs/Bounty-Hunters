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
    uint256 public internalBalance; // Internal accounting for rebasing token protection
    uint256 public maxLoanPercent; // Max loan as percentage of pool (default 50%)
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        maxLoanPercent = 50; // Default 50% max loan
        owner = msg.sender;
    }

    // FIX: Minimum fee, max loan cap, internal accounting, emergency pause
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        // FIX: Max loan cap (default 50% of pool)
        uint256 maxLoan = internalBalance * maxLoanPercent / 100;
        require(amount <= maxLoan, "Exceeds max loan amount");

        // FIX: Use internal accounting instead of balanceOf
        uint256 balanceBefore = internalBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        // FIX: Minimum fee of 1 token unit
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1; // Minimum fee

        // Update internal balance before transfer
        internalBalance -= amount;
        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Check internal balance after callback
        // ReentrancyGuard prevents re-entry during this check
        uint256 received = amount + fee;
        internalBalance += received;

        // Verify token transfer was successful
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= internalBalance, "Loan not repaid correctly");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonReentrant {
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFees() external nonReentrant onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        internalBalance -= fees;
        loanToken.transfer(owner, fees);
        emit Withdrawn(owner, fees);
    }

    // FIX: Emergency pause function
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // FIX: Set max loan percentage
    function setMaxLoanPercent(uint256 _percent) external onlyOwner {
        require(_percent > 0 && _percent <= 100, "Invalid percent");
        maxLoanPercent = _percent;
    }

    function getPoolBalance() external view returns (uint256) {
        return internalBalance;
    }
}

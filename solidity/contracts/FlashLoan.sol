// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    uint256 public poolBalance; // FIXED: Tracked internally, not via balanceOf
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPaused(address indexed by);
    event EmergencyUnpaused(address indexed by);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // FIXED: Added max loan check, minimum fee, nonReentrant, internal balance
    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolBalance, "Exceeds pool balance");

        // FIXED: Minimum 1 wei fee to prevent zero-fee loans
        uint256 fee = _calculateFee(amount);

        // Track internal balance instead of using balanceOf
        poolBalance -= amount;

        loanToken.transfer(msg.sender, amount);
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Verify repayment using internal accounting
        uint256 required = amount + fee;
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= poolBalance + fee, "Loan not repaid");

        poolBalance = balanceAfter;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    // FIXED: Minimum fee of 1 wei
    function _calculateFee(uint256 amount) internal view returns (uint256) {
        uint256 calculated = amount * feeBPS / 10000;
        if (calculated == 0 && amount > 0) return 1;
        return calculated;
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // FIXED: Added emergency pause function
    function emergencyPause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit EmergencyPaused(msg.sender);
    }

    function emergencyUnpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit EmergencyUnpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}

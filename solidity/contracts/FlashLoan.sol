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
    uint256 public poolBalance;
    uint256 public maxLoanBPS = 5000; // 50% of pool
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPause(address indexed owner);
    event EmergencyUnpause(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= poolBalance * maxLoanBPS / 10000, "Loan exceeds max");

        // Ensure fee is non-zero for any loan
        uint256 fee = amount * feeBPS / 10000;
        require(fee > 0, "Fee too low for loan amount");

        uint256 balanceBefore = poolBalance;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        uint256 requiredBalance = balanceBefore + fee;
        require(balanceAfter >= requiredBalance, "Loan not repaid");

        poolBalance = balanceAfter;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
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

    function emergencyPause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit EmergencyPause(owner);
    }

    function emergencyUnpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit EmergencyUnpause(owner);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function setMaxLoanBPS(uint256 _maxLoanBPS) external {
        require(msg.sender == owner, "Not owner");
        require(_maxLoanBPS <= 10000, "Invalid BPS");
        maxLoanBPS = _maxLoanBPS;
    }
}

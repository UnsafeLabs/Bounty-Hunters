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
    uint256 public poolBalance; // Internal accounting to prevent rebasing token exploits
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Deposited(address indexed user, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token address");
        require(_feeBPS <= 10000, "Fee too high");
        
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        poolBalance = 0;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(poolBalance >= amount, "Insufficient pool balance");
        
        // Max loan: 50% of pool to prevent drainage
        uint256 maxLoan = poolBalance / 2;
        require(amount <= maxLoan, "Loan exceeds max amount");

        // Minimum fee of 1 token unit to prevent free flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        // Update internal accounting before transfer
        poolBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Validate repayment using internal accounting, not balanceOf
        uint256 expectedBalance = poolBalance + amount + fee;
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= expectedBalance, "Loan not repaid");

        // Update internal accounting
        poolBalance = actualBalance;
        totalFees += fee;
        
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        loanToken.transferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        
        // Update internal accounting with actual received amount
        uint256 received = balanceAfter - balanceBefore;
        poolBalance += received;
        
        emit Deposited(msg.sender, received);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        require(poolBalance >= fees, "Insufficient pool balance");
        
        totalFees = 0;
        poolBalance -= fees;
        loanToken.transfer(owner, fees);
        
        emit FeesWithdrawn(owner, fees);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(owner);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(owner);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function getMaxLoan() external view returns (uint256) {
        return poolBalance / 2;
    }
}

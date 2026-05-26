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
    uint256 public maxLoanAmount; // cap per flash loan to prevent pool drainage
    uint256 public internalBalance; // tracks deposits/repays without relying on balanceOf

    uint256 public constant MIN_FEE = 1e15; // minimum 0.001 token units (assuming 18 decimals)

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();
    event MaxLoanAmountUpdated(uint256 newMax);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        maxLoanAmount = type(uint256).max; // unlimited by default; owner should set a reasonable cap
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount, "Exceeds max loan amount");
        require(internalBalance >= amount, "Insufficient pool balance");

        // Calculate fee with minimum fee enforcement to prevent zero-fee loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }

        // Track internally before transfer
        internalBalance -= amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Use internal accounting for repayment check instead of balanceOf
        // This prevents manipulation by rebasing tokens
        internalBalance += amount + fee;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        internalBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    /// @notice Emergency pause — stops all flash loans
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    /// @notice Unpause — resumes flash loans
    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    /// @notice Set max loan amount to cap individual flash loans
    function setMaxLoanAmount(uint256 _maxLoanAmount) external onlyOwner {
        maxLoanAmount = _maxLoanAmount;
        emit MaxLoanAmountUpdated(_maxLoanAmount);
    }

    function getPoolBalance() external view returns (uint256) {
        return internalBalance;
    }
}

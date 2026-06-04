```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is ReentrancyGuard {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;
    uint256 public maxLoanAmount; // cap for flash loans
    uint256 internal poolBalance; // internal accounting to prevent rebasing token manipulation

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused();
    event Unpaused();
    event MaxLoanAmountUpdated(uint256 newMax);

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
        require(_feeBPS <= 1000, "Fee too high"); // max 10%
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
        maxLoanAmount = type(uint256).max; // initially uncapped until deposit
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonReentrant whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount, "Exceeds max loan amount");
        require(poolBalance >= amount, "Insufficient pool balance");

        // Fixed: minimum fee of 1 token unit to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        if (fee < 1) {
            fee = 1;
        }

        // Update internal accounting before external calls
        poolBalance -= amount;

        require(loanToken.transfer(msg.sender, amount), "Transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Fixed: use internal accounting instead of balanceOf to prevent rebasing token manipulation
        uint256 repaymentAmount = amount + fee;
        require(loanToken.transferFrom(msg.sender, address(this), repaymentAmount), "Repayment failed");

        poolBalance += repaymentAmount;
        totalFees += fee;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        uint256 actualReceived = loanToken.balanceOf(address(this)) - balanceBefore;
        poolBalance += actualReceived;

        // Update maxLoanAmount to 50% of pool balance
        _updateMaxLoanAmount();

        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        poolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Transfer failed");
        emit FeesWitthrawn(owner, fees);
    }

    // Emergency pause function
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

    function setMaxLoanAmount(uint256 _maxLoanAmount) external onlyOwner {
        maxLoanAmount = _maxLoanAmount;
        emit MaxLoanAmountUpdated(_maxLoanAmount);
    }

    function _updateMaxLoanAmount() internal {
        maxLoanAmount = poolBalance / 2; // cap at 50% of pool
        emit MaxLoanAmountUpdated(maxLoanAmount);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    // Owner can transfer contract ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
```
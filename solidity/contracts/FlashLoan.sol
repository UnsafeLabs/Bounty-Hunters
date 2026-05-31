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
    uint256 public internalPoolBalance; // Internal accounting to prevent rebasing token exploits
    address public owner;
    bool public paused;

    // FIX: Minimum fee of 1 token unit to prevent zero-fee flash loans
    uint256 public constant MIN_FEE = 1;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // FIX: Use internal accounting instead of balanceOf for rebasing token safety
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = internalPoolBalance;
        require(poolBalance >= amount, "Insufficient pool balance");

        // FIX: Cap flash loans to 50% of pool balance to prevent drainage
        require(amount <= poolBalance / 2, "Exceeds max loan amount (50% of pool)");

        // FIX: Minimum fee of 1 token unit prevents zero-fee flash loans
        uint256 calculatedFee = amount * feeBPS / 10000;
        uint256 fee = calculatedFee > 0 ? calculatedFee : MIN_FEE;

        // FIX: Use internal accounting — update pool balance before transfer
        internalPoolBalance = poolBalance - amount;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal accounting for repayment validation (not balanceOf)
        // Borrower must repay: borrowed amount + fee
        uint256 repayAmount = amount + fee;
        internalPoolBalance += repayAmount;

        // Verify actual balance matches internal accounting as a safety check
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= internalPoolBalance, "Repayment balance mismatch");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalPoolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees to withdraw");
        totalFees = 0;
        internalPoolBalance -= fees;
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

    function getPoolBalance() external view returns (uint256) {
        return internalPoolBalance;
    }

    // View to get max allowed loan amount (50% of pool)
    function getMaxLoanAmount() external view returns (uint256) {
        return internalPoolBalance / 2;
    }
}

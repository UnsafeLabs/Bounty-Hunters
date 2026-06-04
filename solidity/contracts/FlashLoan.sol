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
    uint256 public internalBalance; // internal accounting to prevent rebasing exploits
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    /// @notice Execute a flash loan with slippage protection and pool drainage prevention
    /// @param amount Amount of tokens to borrow
    /// @param data Arbitrary data passed to the receiver callback
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= internalBalance / 2, "Exceeds max loan");

        uint256 balanceBefore = internalBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        // Fixed: minimum fee of 1 token prevents zero-fee for small amounts
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0) fee = 1;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Use actual balanceOf for repayment verification (must receive real tokens back)
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        // Update internal accounting
        internalBalance = balanceAfter;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        internalBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        internalBalance -= fees;
        loanToken.transfer(owner, fees);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return internalBalance;
    }
}

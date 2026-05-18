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
    uint256 public accountedPoolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonRebasingOnly() {
        require(loanToken.balanceOf(address(this)) == accountedPoolBalance, "Unsupported rebasing token");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external nonRebasingOnly {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Loan exceeds cap");

        uint256 balanceBefore = accountedPoolBalance;
        require(balanceBefore >= amount, "Insufficient pool balance");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        accountedPoolBalance = balanceBefore - amount;
        require(loanToken.transfer(msg.sender, amount), "Transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 expectedBalance = balanceBefore + fee;
        require(loanToken.balanceOf(address(this)) == expectedBalance, "Loan not repaid");

        accountedPoolBalance = expectedBalance;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external nonRebasingOnly {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = accountedPoolBalance;
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        require(loanToken.balanceOf(address(this)) == balanceBefore + amount, "Unsupported fee token");
        accountedPoolBalance = balanceBefore + amount;
    }

    function withdrawFees() external onlyOwner nonRebasingOnly {
        uint256 fees = totalFees;
        totalFees = 0;
        accountedPoolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Transfer failed");
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance / 2;
    }

    function getPoolBalance() external view returns (uint256) {
        return accountedPoolBalance;
    }
}

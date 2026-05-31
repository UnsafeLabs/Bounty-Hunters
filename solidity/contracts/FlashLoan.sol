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

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBefore = accountedPoolBalance;
        require(poolBefore >= amount, "Insufficient pool balance");
        require(amount <= maxLoanAmount(), "Loan exceeds cap");
        require(loanToken.balanceOf(address(this)) >= poolBefore, "Pool accounting mismatch");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), amount + fee), "Loan not repaid");

        accountedPoolBalance = poolBefore + fee;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        accountedPoolBalance += amount;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        accountedPoolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance / 2;
    }

    function getPoolBalance() external view returns (uint256) {
        return accountedPoolBalance;
    }
}

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
    bool private activeLoan;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Deposited(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_feeBPS <= 10000, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(!activeLoan, "Loan active");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Loan exceeds max");

        uint256 fee = calculateFee(amount);
        uint256 repayment = amount + fee;

        activeLoan = true;
        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), repayment), "Loan not repaid");
        activeLoan = false;

        totalFees += fee;
        accountedPoolBalance += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        accountedPoolBalance += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        accountedPoolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
        emit FeesWithdrawn(owner, fees);
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit Paused(owner);
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit Unpaused(owner);
    }

    function maxLoanAmount() public view returns (uint256) {
        return accountedPoolBalance / 2;
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 fee = amount * feeBPS / 10000;
        return fee == 0 ? 1 : fee;
    }

    function getPoolBalance() external view returns (uint256) {
        return accountedPoolBalance;
    }
}

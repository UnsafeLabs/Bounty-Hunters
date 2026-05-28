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
    uint256 private poolBalance;
    address public owner;
    bool public paused;
    bool private activeLoan;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= 10000, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(!activeLoan, "Loan active");
        require(amount > 0, "Amount must be > 0");

        uint256 availablePool = poolBalance;
        require(amount <= availablePool, "Insufficient pool balance");
        require(amount <= availablePool / 2, "Amount exceeds max loan");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        poolBalance = availablePool - amount;
        activeLoan = true;

        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(
            loanToken.transferFrom(msg.sender, address(this), amount + fee),
            "Loan repayment failed"
        );

        activeLoan = false;
        poolBalance = availablePool;
        totalFees += fee;
        require(
            loanToken.balanceOf(address(this)) >= poolBalance + totalFees,
            "Pool accounting mismatch"
        );

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(
            loanToken.transferFrom(msg.sender, address(this), amount),
            "Deposit transfer failed"
        );
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
        emit FeesWithdrawn(owner, fees);
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
        return poolBalance;
    }
}

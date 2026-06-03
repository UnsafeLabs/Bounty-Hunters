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

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(poolBalance >= amount, "Insufficient pool balance");
        require(amount <= maxLoanAmount(), "Exceeds max loan");

        uint256 fee = calculateFee(amount);
        uint256 repayment = amount + fee;

        poolBalance -= amount;
        require(loanToken.transfer(msg.sender, amount), "Transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), repayment), "Loan not repaid");

        poolBalance += repayment;
        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        require(poolBalance >= fees, "Insufficient pool balance");

        totalFees = 0;
        poolBalance -= fees;
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

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) {
            return 1;
        }
        return fee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return poolBalance / 2;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}

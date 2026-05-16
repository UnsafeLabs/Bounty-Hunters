// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    uint256 private constant BASIS_POINTS = 10_000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= poolBalance / 2, "Exceeds max loan");

        uint256 fee = calculateFee(amount);

        require(loanToken.transfer(msg.sender, amount), "Loan transfer failed");

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.transferFrom(msg.sender, address(this), amount + fee), "Loan not repaid");

        totalFees += fee;
        poolBalance += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Deposit failed");
        poolBalance += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        poolBalance -= fees;
        require(loanToken.transfer(owner, fees), "Fee transfer failed");
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 fee = amount * feeBPS / BASIS_POINTS;
        return fee == 0 ? 1 : fee;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}

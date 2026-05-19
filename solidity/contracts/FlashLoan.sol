// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    address public owner;
    bool public paused;

    // Internal accounting for rebasing token protection
    uint256 private _poolDeposits;

    uint256 public constant MAX_LOAN_BPS = 5000; // 50% max

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPause(address indexed pauser, bool paused);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = loanToken.balanceOf(address(this));
        require(poolBalance >= amount, "Insufficient pool balance");

        // Max loan: 50% of pool balance
        uint256 maxLoan = (poolBalance * MAX_LOAN_BPS) / 10000;
        require(amount <= maxLoan, "Exceeds max loan amount");

        // Minimum fee of 1 wei prevents free flash loans
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0) fee = 1;

        uint256 totalRepayment = amount + fee;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // Internal accounting: poolDeposits + totalFees is invariant
        uint256 expectedBalance = _poolDeposits + totalFees;
        uint256 actualBalance = loanToken.balanceOf(address(this));
        require(actualBalance >= expectedBalance + totalRepayment, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        _poolDeposits += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit EmergencyPause(msg.sender, true);
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit EmergencyPause(msg.sender, false);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}

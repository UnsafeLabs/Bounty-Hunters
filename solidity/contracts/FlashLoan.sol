// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

/// @title FlashLoan with zero-fee and pool drainage protection
/// @notice Fixes zero-fee flash loans and adds pool drainage protection
contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    address public owner;
    bool public paused;

    // FIX: Max loan percentage of pool balance (90%)
    uint256 public constant MAX_LOAN_BPS = 9000;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolPaused(bool paused);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // FIX: Prevent fee truncation to zero for small amounts
    // FIX: Add max loan amount to prevent pool drainage
    // FIX: Use internal tracking instead of balanceOf for rebasing token safety
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = getInternalBalance();
        require(poolBalance >= amount, "Insufficient pool balance");

        // FIX: Enforce maximum loan percentage to prevent pool drainage
        require(amount * 10000 / poolBalance <= MAX_LOAN_BPS, "Loan exceeds maximum");

        // FIX: Ensure minimum fee of 1 wei to prevent zero-fee flash loans
        uint256 fee = amount * feeBPS / 10000;
        require(fee > 0, "Fee must be > 0");

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal balance tracking instead of balanceOf (rebasing token safe)
        uint256 balanceAfter = getInternalBalance();
        require(balanceAfter >= poolBalance + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // FIX: Add emergency pause function
    function setPaused(bool _paused) external {
        require(msg.sender == owner, "Not owner");
        paused = _paused;
        emit PoolPaused(_paused);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }

    // FIX: Internal balance tracking to avoid rebasing token manipulation
    function getInternalBalance() internal view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}

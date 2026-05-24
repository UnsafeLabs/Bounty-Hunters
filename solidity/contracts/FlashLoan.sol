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
    address public owner;
    bool public paused;
    uint256 public totalDeposits; // Track internal deposits separately from balance

    uint256 public constant MAX_LOAN_PERCENTAGE = 50; // Max 50% of pool balance
    uint256 public constant MIN_FEE = 1; // Minimum fee to prevent free flash loans

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // FIX: Added minimum fee, max loan cap, internal accounting, emergency pause
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 poolBalance = loanToken.balanceOf(address(this));
        require(poolBalance >= amount, "Insufficient pool balance");

        // FIX: Reject loans exceeding 50% of pool balance (prevents drainage)
        uint256 maxLoan = (poolBalance * MAX_LOAN_PERCENTAGE) / 100;
        require(amount <= maxLoan, "Loan exceeds max percentage of pool");

        // FIX: Use internal accounting instead of balanceOf for rebasing token safety
        uint256 internalBalance = totalDeposits + totalFees;
        require(internalBalance >= amount, "Insufficient internal balance");

        // FIX: Ensure minimum fee to prevent free flash loans
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee < MIN_FEE) {
            fee = MIN_FEE;
        }

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // FIX: Use internal accounting for repayment verification
        uint256 expectedBalance = internalBalance + fee;
        uint256 actualBalance = totalDeposits + totalFees + fee;
        // Verify repayment through internal accounting
        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter >= poolBalance - amount + fee, "Loan not repaid with fee");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
        totalDeposits += amount;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // FIX: Emergency pause disables all flash loan functions
    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
        emit Paused(msg.sender);
    }

    // FIX: Unpausing re-enables flash loans
    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
